#!/usr/bin/env python3
"""AGX Bundle installer — install, uninstall, and list bundles.

Installation layout under ``~/.agenticx/``::

    bundles.json                           <- installed bundle registry
    skills/bundles/<bundle-name>/          <- skills from the bundle (symlinked dirs)
        <skill-name>/
            SKILL.md
    avatars/presets/<bundle-name>/         <- avatar preset YAML files
        <avatar-name>.yaml
    workspace/memory_templates/<bundle-name>/  <- memory template files
        <template-name>.md

MCP server configs are merged into ``~/.agenticx/mcp.json``.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

_AGENTICX_HOME = Path.home() / ".agenticx"
_BUNDLES_JSON = _AGENTICX_HOME / "bundles.json"
_SKILLS_BUNDLES_DIR = _AGENTICX_HOME / "skills" / "bundles"
_AVATARS_PRESETS_DIR = _AGENTICX_HOME / "avatars" / "presets"
_MEMORY_TEMPLATES_DIR = _AGENTICX_HOME / "workspace" / "memory_templates"
_MCP_JSON = _AGENTICX_HOME / "mcp.json"

_lock = threading.RLock()

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(name: str) -> str:
    cleaned = _SAFE_SEGMENT.sub("_", str(name)).strip("._") or "unnamed"
    return cleaned[:120]


def _run_coro_sync(coro: Any) -> Any:
    """Run a coroutine on a worker thread (keeps the caller's loop untouched)."""
    import asyncio
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


@dataclass
class FetchedRemoteSkill:
    """A verified skill pulled from a remote MCP skills server.

    ``files`` maps relative paths (``SKILL.md``, ``references/x.md``, ...) to
    bytes already verified at the reading point (digest + size + frontmatter)
    by :class:`~agenticx.skills.remote_provider.RemoteSkillProvider`.
    """

    server: str
    manifest: Any
    files: Dict[str, bytes] = field(default_factory=dict)

    @property
    def skill_name(self) -> str:
        name = ""
        try:
            name = str(self.manifest.name or "").strip()
        except Exception:
            name = ""
        if name:
            return name
        uri = str(getattr(self.manifest, "uri", "") or "")
        segments = [s for s in uri.rstrip("/").split("/") if s]
        return segments[-2] if len(segments) >= 2 else (segments[-1] if segments else "unnamed")


class McpSkillFetcher:
    """Fetch skills from MCP servers configured in ``~/.agenticx/mcp.json``.

    The fetch goes through MCPClientV2 + RemoteSkillProvider, so every file is
    verified at the reading point before it is staged into the skill cache.
    """

    def __init__(self, mcp_config_path: Optional[Path] = None) -> None:
        self.mcp_config_path = (
            Path(mcp_config_path)
            if mcp_config_path is not None
            else Path.home() / ".agenticx" / "mcp.json"
        )

    def fetch(self, server: str, uri: str) -> FetchedRemoteSkill:
        return _run_coro_sync(self._fetch(server, uri))

    def __call__(self, server: str, uri: str) -> FetchedRemoteSkill:
        # Lets the instance be passed directly as `skill_fetcher=`.
        return self.fetch(server, uri)

    def _server_config(self, server: str) -> Any:
        from agenticx.tools.remote_v2 import MCPServerConfig

        if not self.mcp_config_path.is_file():
            raise FileNotFoundError(
                f"MCP server '{server}' is not configured: {self.mcp_config_path} not found"
            )
        try:
            data = json.loads(self.mcp_config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise ValueError(f"Failed to read {self.mcp_config_path}: {exc}") from exc
        entry = (data.get("mcpServers") or {}).get(server)
        if not isinstance(entry, dict):
            raise KeyError(
                f"MCP server '{server}' is not configured in {self.mcp_config_path}"
            )
        return MCPServerConfig(name=server, **entry)

    async def _fetch(self, server: str, uri: str) -> FetchedRemoteSkill:
        from agenticx.skills.remote_provider import RemoteSkillProvider
        from agenticx.tools.remote_v2 import MCPClientV2

        config = self._server_config(server)
        client = MCPClientV2(config)
        try:
            async with client:
                provider = RemoteSkillProvider(client, server_id=server)
                manifest = await provider.retain(uri)
                if manifest.is_dynamic:
                    raise ValueError(
                        f"skill {uri!r} is 'dynamic'; bundles require a static manifest"
                    )
                root = manifest.uri
                if root.endswith("/SKILL.md"):
                    root = root[: -len("/SKILL.md")]
                files: Dict[str, bytes] = {}
                for file_uri in manifest.file_uris():
                    if not file_uri.startswith(root + "/"):
                        raise ValueError(
                            f"skill file {file_uri!r} is outside the root of {uri!r}"
                        )
                    remote_file = await provider.read_file(file_uri)
                    files[file_uri[len(root) + 1:]] = remote_file.content
                if "SKILL.md" not in files:
                    raise ValueError(f"skill {uri!r} did not return a SKILL.md")
                return FetchedRemoteSkill(server=server, manifest=manifest, files=files)
        finally:
            try:
                await client.close()
            except Exception:  # pragma: no cover - best-effort cleanup
                pass


def _remote_skill_cache_dir(server: str, skill_name: str) -> Path:
    # Lazy (not module-level) so tests can monkeypatch Path.home.
    return Path.home() / ".agenticx" / "skills" / "cache" / _safe_segment(server) / _safe_segment(skill_name)


def _stage_remote_skill_cache(fetched: FetchedRemoteSkill) -> Path:
    """Materialize verified bytes under the skill cache (read-only files)."""
    stage_dir = _remote_skill_cache_dir(fetched.server, fetched.skill_name)
    if stage_dir.exists():
        # Cache files are read-only; remove the tree before restaging.
        shutil.rmtree(stage_dir, ignore_errors=True)
    stage_dir.mkdir(parents=True)
    for rel, raw in fetched.files.items():
        segments = [s for s in rel.split("/")]
        if any(s in ("", ".", "..") for s in segments):
            raise ValueError(f"remote skill file escapes the cache root: {rel!r}")
        target = (stage_dir.joinpath(*segments)).resolve()
        target.relative_to(stage_dir.resolve())
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        os.chmod(target, 0o444)
    return stage_dir


def _publish_mcp_skill_to_registry(skill_dir: Path, name: str, server: str) -> Dict[str, Any]:
    """Record an installed remote skill in the local registry (origin='mcp')."""
    from agenticx.skills.registry import (
        RegistryStorage,
        build_registry_entry,
        publish_with_auto_bump,
    )

    try:
        entry = build_registry_entry(skill_dir, origin="mcp")
        if entry.author == "unknown":
            entry.author = f"mcp:{server}"
        stored = publish_with_auto_bump(RegistryStorage(), entry)
        logger.info(
            "Published MCP skill '%s' v%s (server '%s') to the local registry",
            name,
            stored.version,
            server,
        )
        return {"ok": True, "version": stored.version}
    except Exception as exc:
        logger.warning("Registry publish failed for MCP skill '%s': %s", name, exc)
        return {"ok": False, "error": str(exc)}


def _record_remote_skill_approval(
    fetched: FetchedRemoteSkill,
) -> Dict[str, Any]:
    """Bundle installation is explicit user consent: bind it to the digest set."""
    try:
        from agenticx.skills.approval import ApprovalStore

        approval = ApprovalStore().grant(
            fetched.server, fetched.manifest, origin="mcp"
        )
        return {"ok": True, "key": approval.key}
    except Exception as exc:
        logger.warning(
            "Failed to record approval for remote skill '%s': %s",
            fetched.skill_name,
            exc,
        )
        return {"ok": False, "error": str(exc)}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class InstalledBundle:
    """Record of an installed AGX Bundle."""

    name: str
    version: str
    description: str
    author: str
    installed_at: str
    source_dir: str
    skills: List[str] = field(default_factory=list)
    mcp_servers: List[str] = field(default_factory=list)
    avatars: List[str] = field(default_factory=list)
    memory_templates: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "installed_at": self.installed_at,
            "source_dir": self.source_dir,
            "skills": self.skills,
            "mcp_servers": self.mcp_servers,
            "avatars": self.avatars,
            "memory_templates": self.memory_templates,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InstalledBundle":
        return cls(
            name=str(data.get("name", "")),
            version=str(data.get("version", "0.1.0")),
            description=str(data.get("description", "")),
            author=str(data.get("author", "unknown")),
            installed_at=str(data.get("installed_at", _now_iso())),
            source_dir=str(data.get("source_dir", "")),
            skills=list(data.get("skills", [])),
            mcp_servers=list(data.get("mcp_servers", [])),
            avatars=list(data.get("avatars", [])),
            memory_templates=list(data.get("memory_templates", [])),
        )


@dataclass
class InstallResult:
    """Result of a bundle install operation."""

    success: bool
    name: str = ""
    version: str = ""
    error: str = ""
    skills_installed: List[str] = field(default_factory=list)
    mcp_servers_installed: List[str] = field(default_factory=list)
    avatars_installed: List[str] = field(default_factory=list)
    memory_templates_installed: List[str] = field(default_factory=list)
    scan_summary: Optional[Dict[str, Any]] = None
    error_code: Optional[str] = None


# ---------------------------------------------------------------------------
# bundles.json helpers
# ---------------------------------------------------------------------------

def _load_bundles_registry() -> Dict[str, Any]:
    if not _BUNDLES_JSON.exists():
        return {"bundles": {}}
    try:
        raw = json.loads(_BUNDLES_JSON.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("bundles"), dict):
            return raw
    except Exception as exc:
        logger.warning("Failed to read bundles.json: %s", exc)
    return {"bundles": {}}


def _save_bundles_registry(data: Dict[str, Any]) -> None:
    _AGENTICX_HOME.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        delete=False,
        dir=str(_BUNDLES_JSON.parent),
        prefix=f"{_BUNDLES_JSON.name}.tmp.",
    ) as handle:
        handle.write(encoded)
        tmp_path = Path(handle.name)
    os.replace(tmp_path, _BUNDLES_JSON)


# ---------------------------------------------------------------------------
# mcp.json helpers
# ---------------------------------------------------------------------------

def _load_mcp_json() -> Dict[str, Any]:
    if not _MCP_JSON.exists():
        return {"mcpServers": {}}
    try:
        raw = json.loads(_MCP_JSON.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            if "mcpServers" not in raw:
                raw["mcpServers"] = {}
            return raw
    except Exception as exc:
        logger.warning("Failed to read mcp.json: %s", exc)
    return {"mcpServers": {}}


def _save_mcp_json(data: Dict[str, Any]) -> None:
    _AGENTICX_HOME.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        delete=False,
        dir=str(_MCP_JSON.parent),
        prefix=f"{_MCP_JSON.name}.tmp.",
    ) as handle:
        handle.write(encoded)
        tmp_path = Path(handle.name)
    os.replace(tmp_path, _MCP_JSON)


# ---------------------------------------------------------------------------
# Bundle skill scan (pre-install)
# ---------------------------------------------------------------------------


def scan_bundle_source(
    source: Path,
    *,
    skill_fetcher: Optional[Callable[[str, str], FetchedRemoteSkill]] = None,
) -> Dict[str, Any]:
    """Parse bundle manifest and scan each referenced skill.

    Local skill refs are scanned from the bundle directory. Remote (MCP) refs
    are fetched through ``skill_fetcher`` (server, uri), staged into the
    skill cache, and scanned from there (``scan_skill_deep``). The staged
    remote skills are returned under the internal ``"remote"`` key for
    :func:`install_bundle` to reuse.

    Returns:
        Dict with keys: ok (bool), overall (verdict), skills (list), bundle_name,
        remote (dict, uri -> staging info), error (optional).
    """
    from agenticx.extensions.bundle import BundleParseError, parse_bundle_manifest
    from agenticx.skills.guard import ScanVerdict, merge_verdicts, scan_result_to_payload, scan_skill, scan_skill_deep

    try:
        manifest = parse_bundle_manifest(source)
    except (BundleParseError, FileNotFoundError) as exc:
        return {"ok": False, "error": str(exc)}

    per_skill: List[Dict[str, Any]] = []
    verdicts: List[ScanVerdict] = []
    remote: Dict[str, Dict[str, Any]] = {}
    for skill_ref in manifest.skills:
        if skill_ref.is_remote:
            server = skill_ref.mcp["server"]
            uri = skill_ref.mcp["uri"]
            if skill_fetcher is None:
                return {
                    "ok": False,
                    "error": (
                        f"skill '{uri}' references MCP server '{server}' but no "
                        "skill fetcher is configured"
                    ),
                }
            try:
                fetched = skill_fetcher(server, uri)
                stage_dir = _stage_remote_skill_cache(fetched)
            except Exception as exc:
                return {
                    "ok": False,
                    "error": (
                        f"failed to fetch remote skill '{uri}' from MCP server "
                        f"'{server}': {exc}"
                    ),
                }
            remote[uri] = {
                "server": server,
                "skill_name": fetched.skill_name,
                "cache_dir": stage_dir,
                "fetched": fetched,
            }
            sr = scan_skill_deep(stage_dir, source="community")
            per_skill.append(scan_result_to_payload(sr, fetched.skill_name))
            verdicts.append(sr.verdict)
            continue
        skill_md = skill_ref.resolved_path(manifest.source_dir)
        skill_dir = skill_md.parent
        sr = scan_skill(skill_dir, source="community")
        per_skill.append(scan_result_to_payload(sr, skill_dir.name))
        verdicts.append(sr.verdict)

    overall = merge_verdicts(verdicts)
    return {
        "ok": True,
        "bundle_name": manifest.name,
        "overall": overall,
        "skills": per_skill,
        "remote": remote,
    }


def _bundle_scan_summary_from_dict(scan: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "overall": scan.get("overall"),
        "skills": scan.get("skills", []),
        "bundle_name": scan.get("bundle_name"),
    }


# ---------------------------------------------------------------------------
# install_bundle
# ---------------------------------------------------------------------------

def install_bundle(
    source: Path,
    *,
    acknowledge_high_risk: bool = False,
    confirm_non_high_risk: bool = False,
    auto_non_high: bool = True,
    skill_fetcher: Optional[Callable[[str, str], FetchedRemoteSkill]] = None,
) -> InstallResult:
    """Install an AGX Bundle from a local directory.

    Steps:
      1. Parse ``agx-bundle.yaml`` manifest.
      2. Copy skill directories to ``~/.agenticx/skills/bundles/<name>/``.
         Remote (``mcp:``) skill refs are fetched with ``skill_fetcher``
         (default: :class:`McpSkillFetcher` over ``~/.agenticx/mcp.json``),
         staged into the skill cache, and installed after the same safety
         gates; the install records a digest-bound approval and publishes the
         skill to the registry with ``origin="mcp"``.
      3. Load/merge MCP server configs into ``~/.agenticx/mcp.json``.
      4. Copy avatar preset files to ``~/.agenticx/avatars/presets/<name>/``.
      5. Copy memory templates to ``~/.agenticx/workspace/memory_templates/<name>/``.
      6. Record install in ``~/.agenticx/bundles.json``.

    Args:
        source: Path to the bundle directory (must contain ``agx-bundle.yaml``).
        acknowledge_high_risk: Allow installing bundles whose scan verdict is
            ``dangerous``.
        confirm_non_high_risk: Confirm installing safe/caution bundles when
            ``auto_non_high`` is False.
        auto_non_high: Automatically install non-dangerous bundles.
        skill_fetcher: Callable ``(server, uri) -> FetchedRemoteSkill`` used to
            pull remote skills; defaults to :class:`McpSkillFetcher`.

    Returns:
        :class:`InstallResult` with success flag and component lists.
    """
    from agenticx.extensions.bundle import BundleParseError, parse_bundle_manifest

    try:
        manifest = parse_bundle_manifest(source)
    except (BundleParseError, FileNotFoundError) as exc:
        return InstallResult(success=False, error=str(exc))

    has_remote_refs = any(ref.is_remote for ref in manifest.skills)
    if skill_fetcher is None and has_remote_refs:
        skill_fetcher = McpSkillFetcher()

    scan_raw = scan_bundle_source(source, skill_fetcher=skill_fetcher)
    if not scan_raw.get("ok"):
        return InstallResult(
            success=False,
            error=str(scan_raw.get("error", "scan failed")),
        )
    remote_staged: Dict[str, Dict[str, Any]] = scan_raw.get("remote", {}) or {}
    summary = _bundle_scan_summary_from_dict(scan_raw)
    overall = str(summary.get("overall") or "safe")
    if overall == "dangerous" and not acknowledge_high_risk:
        return InstallResult(
            success=False,
            error="high_risk_confirm_required",
            error_code="high_risk_confirm_required",
            scan_summary=summary,
        )
    if overall in ("safe", "caution") and not auto_non_high and not confirm_non_high_risk:
        return InstallResult(
            success=False,
            error="non_high_risk_confirm_required",
            error_code="non_high_risk_confirm_required",
            scan_summary=summary,
        )

    with _lock:
        bundle_name = manifest.name
        skills_installed: List[str] = []
        mcp_installed: List[str] = []
        avatars_installed: List[str] = []
        memory_installed: List[str] = []

        # 1. Install skills
        skills_target = _SKILLS_BUNDLES_DIR / bundle_name
        skills_target.mkdir(parents=True, exist_ok=True)
        for skill_ref in manifest.skills:
            if skill_ref.is_remote:
                info = remote_staged.get(skill_ref.mcp["uri"])
                if info is None:
                    logger.warning(
                        "Remote skill '%s' was not staged during scan; skipping",
                        skill_ref.mcp["uri"],
                    )
                    continue
                fetched = info["fetched"]
                dest_dir = skills_target / info["skill_name"]
                try:
                    if dest_dir.exists():
                        shutil.rmtree(dest_dir)
                    shutil.copytree(str(info["cache_dir"]), str(dest_dir))
                    # Cache files are read-only; installed copies stay writable.
                    for installed in dest_dir.rglob("*"):
                        if installed.is_file():
                            os.chmod(installed, 0o644)
                    # Installing the bundle is explicit user consent: bind the
                    # approval to the fetched digest set (SP1 chain).
                    _record_remote_skill_approval(fetched)
                    _publish_mcp_skill_to_registry(
                        dest_dir, info["skill_name"], info["server"]
                    )
                    skills_installed.append(info["skill_name"])
                    logger.info(
                        "Installed remote skill '%s' from server '%s' to %s",
                        info["skill_name"],
                        info["server"],
                        dest_dir,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to install remote skill '%s': %s",
                        info["skill_name"],
                        exc,
                    )
                continue
            skill_md = skill_ref.resolved_path(manifest.source_dir)
            # Each skill lives in a directory named by its parent folder
            skill_dir = skill_md.parent
            dest_dir = skills_target / skill_dir.name
            try:
                if dest_dir.exists():
                    shutil.rmtree(dest_dir)
                shutil.copytree(str(skill_dir), str(dest_dir))
                skills_installed.append(skill_dir.name)
                logger.info("Installed skill '%s' to %s", skill_dir.name, dest_dir)
            except Exception as exc:
                logger.warning("Failed to install skill '%s': %s", skill_dir.name, exc)

        # 2. Merge MCP server configs
        mcp_data = _load_mcp_json()
        for mcp_ref in manifest.mcp_servers:
            config_path = mcp_ref.resolved_config_path(manifest.source_dir)
            if not config_path.exists():
                logger.warning("MCP config file not found: %s; skipping", config_path)
                continue
            try:
                server_config = json.loads(config_path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("Failed to read MCP config %s: %s; skipping", config_path, exc)
                continue
            mcp_data["mcpServers"][mcp_ref.name] = server_config
            mcp_installed.append(mcp_ref.name)
            logger.info("Merged MCP server '%s' into mcp.json", mcp_ref.name)
        _save_mcp_json(mcp_data)

        # 3. Install avatar presets
        avatars_target = _AVATARS_PRESETS_DIR / bundle_name
        avatars_target.mkdir(parents=True, exist_ok=True)
        for avatar_ref in manifest.avatars:
            config_path = avatar_ref.resolved_config_path(manifest.source_dir)
            if not config_path.exists():
                logger.warning("Avatar config not found: %s; skipping", config_path)
                continue
            dest = avatars_target / f"{avatar_ref.name}.yaml"
            try:
                shutil.copy2(str(config_path), str(dest))
                avatars_installed.append(avatar_ref.name)
                logger.info("Installed avatar preset '%s' to %s", avatar_ref.name, dest)
            except Exception as exc:
                logger.warning("Failed to install avatar '%s': %s", avatar_ref.name, exc)

        # 4. Install memory templates
        memory_target = _MEMORY_TEMPLATES_DIR / bundle_name
        memory_target.mkdir(parents=True, exist_ok=True)
        for tpl_ref in manifest.memory_templates:
            tpl_path = tpl_ref.resolved_path(manifest.source_dir)
            if not tpl_path.exists():
                logger.warning("Memory template not found: %s; skipping", tpl_path)
                continue
            dest = memory_target / tpl_path.name
            try:
                shutil.copy2(str(tpl_path), str(dest))
                memory_installed.append(tpl_ref.name)
                logger.info("Installed memory template '%s' to %s", tpl_ref.name, dest)
            except Exception as exc:
                logger.warning("Failed to install memory template '%s': %s", tpl_ref.name, exc)

        # 5. Record in bundles.json
        registry = _load_bundles_registry()
        record = InstalledBundle(
            name=bundle_name,
            version=manifest.version,
            description=manifest.description,
            author=manifest.author,
            installed_at=_now_iso(),
            source_dir=str(manifest.source_dir),
            skills=skills_installed,
            mcp_servers=mcp_installed,
            avatars=avatars_installed,
            memory_templates=memory_installed,
        )
        registry["bundles"][bundle_name] = record.to_dict()
        _save_bundles_registry(registry)

        logger.info(
            "Bundle '%s' v%s installed: skills=%d, mcp=%d, avatars=%d, memory=%d",
            bundle_name,
            manifest.version,
            len(skills_installed),
            len(mcp_installed),
            len(avatars_installed),
            len(memory_installed),
        )

        return InstallResult(
            success=True,
            name=bundle_name,
            version=manifest.version,
            skills_installed=skills_installed,
            mcp_servers_installed=mcp_installed,
            avatars_installed=avatars_installed,
            memory_templates_installed=memory_installed,
        )


# ---------------------------------------------------------------------------
# uninstall_bundle
# ---------------------------------------------------------------------------

def uninstall_bundle(name: str) -> bool:
    """Uninstall an AGX Bundle by name.

    Removes installed skills, avatar presets, memory templates, and
    MCP server entries. Updates ``bundles.json``.

    Args:
        name: Bundle name as recorded in ``bundles.json``.

    Returns:
        True if the bundle was found and removed, False if not installed.
    """
    with _lock:
        registry = _load_bundles_registry()
        bundle_data = registry.get("bundles", {}).get(name)
        if bundle_data is None:
            logger.warning("Bundle '%s' is not installed", name)
            return False

        record = InstalledBundle.from_dict(bundle_data)

        # Remove skills directory
        skills_dir = _SKILLS_BUNDLES_DIR / name
        if skills_dir.exists():
            try:
                shutil.rmtree(str(skills_dir))
                logger.info("Removed skills directory: %s", skills_dir)
            except Exception as exc:
                logger.warning("Failed to remove skills dir %s: %s", skills_dir, exc)

        # Remove avatar presets directory
        avatars_dir = _AVATARS_PRESETS_DIR / name
        if avatars_dir.exists():
            try:
                shutil.rmtree(str(avatars_dir))
                logger.info("Removed avatar presets directory: %s", avatars_dir)
            except Exception as exc:
                logger.warning("Failed to remove avatars dir %s: %s", avatars_dir, exc)

        # Remove memory templates directory
        memory_dir = _MEMORY_TEMPLATES_DIR / name
        if memory_dir.exists():
            try:
                shutil.rmtree(str(memory_dir))
                logger.info("Removed memory templates directory: %s", memory_dir)
            except Exception as exc:
                logger.warning("Failed to remove memory dir %s: %s", memory_dir, exc)

        # Remove MCP server entries
        if record.mcp_servers:
            mcp_data = _load_mcp_json()
            for server_name in record.mcp_servers:
                mcp_data["mcpServers"].pop(server_name, None)
                logger.info("Removed MCP server '%s' from mcp.json", server_name)
            _save_mcp_json(mcp_data)

        # Remove from registry
        registry["bundles"].pop(name, None)
        _save_bundles_registry(registry)

        logger.info("Bundle '%s' uninstalled", name)
        return True


# ---------------------------------------------------------------------------
# list_installed_bundles
# ---------------------------------------------------------------------------

def list_installed_bundles() -> List[InstalledBundle]:
    """Return list of all installed AGX Bundles.

    Reads from ``~/.agenticx/bundles.json``.

    Returns:
        List of :class:`InstalledBundle` instances sorted by name.
    """
    with _lock:
        registry = _load_bundles_registry()
        bundles_obj = registry.get("bundles", {})
        if not isinstance(bundles_obj, dict):
            return []
        result = []
        for data in bundles_obj.values():
            if isinstance(data, dict):
                result.append(InstalledBundle.from_dict(data))
        result.sort(key=lambda b: b.name)
        return result
