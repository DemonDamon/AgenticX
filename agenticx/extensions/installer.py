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
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_AGENTICX_HOME = Path.home() / ".agenticx"
_BUNDLES_JSON = _AGENTICX_HOME / "bundles.json"
_SKILLS_BUNDLES_DIR = _AGENTICX_HOME / "skills" / "bundles"
_AVATARS_PRESETS_DIR = _AGENTICX_HOME / "avatars" / "presets"
_MEMORY_TEMPLATES_DIR = _AGENTICX_HOME / "workspace" / "memory_templates"
_MCP_JSON = _AGENTICX_HOME / "mcp.json"

_lock = threading.RLock()


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
# install_bundle
# ---------------------------------------------------------------------------

def install_bundle(source: Path) -> InstallResult:
    """Install an AGX Bundle from a local directory.

    Steps:
      1. Parse ``agx-bundle.yaml`` manifest.
      2. Copy skill directories to ``~/.agenticx/skills/bundles/<name>/``.
      3. Load/merge MCP server configs into ``~/.agenticx/mcp.json``.
      4. Copy avatar preset files to ``~/.agenticx/avatars/presets/<name>/``.
      5. Copy memory templates to ``~/.agenticx/workspace/memory_templates/<name>/``.
      6. Record install in ``~/.agenticx/bundles.json``.

    Args:
        source: Path to the bundle directory (must contain ``agx-bundle.yaml``).

    Returns:
        :class:`InstallResult` with success flag and component lists.
    """
    from agenticx.extensions.bundle import parse_bundle_manifest, BundleParseError

    try:
        manifest = parse_bundle_manifest(source)
    except (BundleParseError, FileNotFoundError) as exc:
        return InstallResult(success=False, error=str(exc))

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
