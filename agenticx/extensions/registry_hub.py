#!/usr/bin/env python3
"""RegistryHub — aggregate search across multiple AGX extension registries.

Supports four registry types:
  - ``agx``: AgenticX native registry (compatible with agenticx.skills.registry REST API)
  - ``skillhub``: SkillHub public API (search + namespaced complete ZIP installs)
  - ``clawhub``: ClawHub API adapter (search + complete ZIP skill installs)
  - ``local``: Local directory scan (discovers agx-bundle.yaml in subdirectories)

Registry configuration lives in ``~/.agenticx/config.yaml`` under
``extensions.registries``::

    extensions:
      registries:
        - name: official
          url: https://registry.agxbuilder.com
          type: agx
        - name: community
          url: https://example.com/agx-registry.json
          type: agx
        - name: clawhub
          url: https://clawhub.ai/api
          type: clawhub
      scan_dirs:
        - ~/.agenticx/bundles
        - ~/.agenticx/skills/registry

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import shutil
import stat
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Registry hosts are public HTTPS endpoints; do not inherit HTTP(S)_PROXY or SOCKS
# from the environment (SOCKS without socksio breaks httpx; proxies often break TLS).
_REGISTRY_HTTPX = {"trust_env": False}

# ClawHub's published skill format caps a complete bundle at 50 MB. Enforce
# the same ceiling on both the downloaded archive and its expanded content so
# a malformed archive cannot consume unbounded memory or disk space.
MAX_SKILL_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_SKILL_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_SKILL_PACKAGE_FILES = 1_000
MAX_SKILL_PACKAGE_FILE_BYTES = MAX_SKILL_EXPANDED_BYTES

_WINDOWS_INVALID_COMPONENT_CHARS = re.compile(r'[<>:"|?*]')
_WINDOWS_RESERVED_BASENAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

# Built-in ClawHub source when config has no registries or no clawhub entry.
DEFAULT_CLAWHUB_REGISTRY: Dict[str, str] = {
    "name": "clawhub",
    "url": "https://clawhub.ai/api",
    "type": "clawhub",
}

# SkillHub is a virtual built-in source for its native search/download API.
# It is resolved explicitly by the SkillHub UI/tool and is not injected into
# aggregate registry searches, avoiding duplicate cards for mirrored skills.
DEFAULT_SKILLHUB_REGISTRY: Dict[str, str] = {
    "name": "skillhub",
    "url": "https://api.skillhub.cn/api",
    "type": "skillhub",
}


def _ensure_clawhub_registry(
    registries: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], bool]:
    """Return registries with a ClawHub source when none is configured."""
    items = [r for r in registries if isinstance(r, dict)]
    has_clawhub = any(
        str(r.get("type", "")).lower() == "clawhub" and str(r.get("url", "")).strip()
        for r in items
    )
    if has_clawhub:
        return items, False
    return items + [dict(DEFAULT_CLAWHUB_REGISTRY)], True


@dataclass
class SearchResult:
    """A single search result from any registry source."""

    name: str
    description: str
    version: str = "0.1.0"
    author: str = "unknown"
    source: str = ""
    source_type: str = "agx"
    install_hint: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "source": self.source,
            "source_type": self.source_type,
            "install_hint": self.install_hint,
        }
        namespace = self.extra.get("namespace") if isinstance(self.extra, dict) else None
        if isinstance(namespace, dict):
            handle = str(namespace.get("handle") or "").strip().lstrip("@")
            canonical_name = str(namespace.get("canonicalName") or "").strip()
            if handle:
                payload["namespace"] = handle
            if canonical_name:
                payload["canonical_name"] = canonical_name
        return payload


@dataclass
class InstallResult:
    """Result of an install-from-registry operation."""

    success: bool
    name: str = ""
    error: str = ""
    installed_path: str = ""
    scan_summary: Optional[Dict[str, Any]] = None
    error_code: Optional[str] = None


def _safe_package_relative_path(raw_path: str) -> str:
    """Return a cross-platform-safe package path or raise ``ValueError``."""
    raw = str(raw_path or "")
    if not raw or "\x00" in raw or "\\" in raw or raw.startswith("/"):
        raise ValueError(f"Unsafe skill package path: {raw!r}")
    if len(raw) > 240:
        raise ValueError("Skill package path is too long")

    path = PurePosixPath(raw)
    parts = path.parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Unsafe skill package path: {raw!r}")
    for component in parts:
        if len(component) > 120:
            raise ValueError("Skill package path component is too long")
        if (
            any(ord(char) < 32 for char in component)
            or component.endswith((" ", "."))
            or _WINDOWS_INVALID_COMPONENT_CHARS.search(component)
        ):
            raise ValueError(f"Skill package path is not Windows-compatible: {raw!r}")
        basename = component.split(".", 1)[0].upper()
        if basename in _WINDOWS_RESERVED_BASENAMES:
            raise ValueError(f"Skill package path uses a reserved filename: {raw!r}")
    return "/".join(parts)


@dataclass
class RegistrySkillPackage:
    """A validated, in-memory skill folder downloaded from a registry."""

    files: Dict[str, bytes]
    executable_paths: set[str] = field(default_factory=set)
    version: str = ""
    namespace: str = ""
    archive_sha256: str = ""

    @property
    def skill_markdown(self) -> str:
        body = self.files.get("SKILL.md")
        if body is None:
            raise ValueError("Skill package does not contain SKILL.md")
        try:
            return body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("SKILL.md is not valid UTF-8") from exc

    def materialize(self, target_dir: Path) -> Path:
        """Write validated package files beneath ``target_dir`` without executing them."""
        target = Path(target_dir)
        target.mkdir(parents=True, exist_ok=True)
        seen: set[str] = set()
        total_size = 0
        for raw_path, body in self.files.items():
            rel_path = _safe_package_relative_path(raw_path)
            folded = rel_path.casefold()
            if folded in seen:
                raise ValueError(f"Duplicate skill package path: {rel_path}")
            seen.add(folded)
            total_size += len(body)
            if len(body) > MAX_SKILL_PACKAGE_FILE_BYTES:
                raise ValueError(f"Skill package file is too large: {rel_path}")
            if total_size > MAX_SKILL_EXPANDED_BYTES:
                raise ValueError("Expanded skill package exceeds 50 MB")
            destination = target.joinpath(*PurePosixPath(rel_path).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(body)
            if rel_path in self.executable_paths:
                destination.chmod(0o755)
        skill_md = target / "SKILL.md"
        if not skill_md.is_file():
            raise ValueError("Skill package does not contain SKILL.md")
        return skill_md


def _skill_package_from_zip(
    archive: bytes,
    *,
    version: str = "",
) -> RegistrySkillPackage:
    """Validate and expand a ClawHub ZIP into an in-memory skill package."""
    if not archive or len(archive) > MAX_SKILL_ARCHIVE_BYTES:
        raise ValueError("Skill package archive is empty or exceeds 50 MB")

    try:
        zf = zipfile.ZipFile(io.BytesIO(archive))
    except zipfile.BadZipFile as exc:
        raise ValueError("Downloaded skill package is not a valid ZIP archive") from exc

    with zf:
        entries: list[tuple[zipfile.ZipInfo, str, bool]] = []
        expanded_size = 0
        for info in zf.infolist():
            if info.is_dir():
                continue
            raw_name = info.filename
            if (
                raw_name.startswith("__MACOSX/")
                or raw_name == ".DS_Store"
                or raw_name.endswith("/.DS_Store")
            ):
                continue
            if info.flag_bits & 0x1:
                raise ValueError("Encrypted files are not allowed in skill packages")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(unix_mode):
                raise ValueError(f"Symbolic links are not allowed in skill packages: {raw_name}")
            safe_name = _safe_package_relative_path(raw_name)
            if info.file_size > MAX_SKILL_PACKAGE_FILE_BYTES:
                raise ValueError(f"Skill package file is too large: {safe_name}")
            expanded_size += info.file_size
            if expanded_size > MAX_SKILL_EXPANDED_BYTES:
                raise ValueError("Expanded skill package exceeds 50 MB")
            entries.append((info, safe_name, bool(unix_mode & 0o111)))
            if len(entries) > MAX_SKILL_PACKAGE_FILES:
                raise ValueError("Skill package contains too many files")

        if not entries:
            raise ValueError("Downloaded skill package is empty")

        # Official archives place SKILL.md at the root. Accept one wrapper
        # directory as well, because some compatible registries package the
        # folder itself rather than only its contents.
        root_skill = any(
            len(PurePosixPath(name).parts) == 1 and name.casefold() == "skill.md"
            for _, name, _ in entries
        )
        strip_wrapper = False
        if not root_skill:
            roots = {PurePosixPath(name).parts[0] for _, name, _ in entries}
            if len(roots) == 1:
                strip_wrapper = any(
                    len(PurePosixPath(name).parts) == 2
                    and PurePosixPath(name).parts[1].casefold() == "skill.md"
                    for _, name, _ in entries
                )

        files: Dict[str, bytes] = {}
        executable_paths: set[str] = set()
        seen: set[str] = set()
        for info, safe_name, executable in entries:
            parts = PurePosixPath(safe_name).parts
            if strip_wrapper:
                parts = parts[1:]
            if not parts:
                continue
            final_name = _safe_package_relative_path("/".join(parts))
            if final_name.casefold() == "skill.md":
                final_name = "SKILL.md"
            # Registry packages must not be able to spoof local provenance.
            if final_name.casefold() == ".agx-skill-provenance.json":
                continue
            folded = final_name.casefold()
            if folded in seen:
                raise ValueError(f"Duplicate skill package path: {final_name}")
            seen.add(folded)
            try:
                body = zf.read(info)
            except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
                raise ValueError(f"Failed to read skill package file: {safe_name}") from exc
            if len(body) != info.file_size:
                raise ValueError(f"Skill package file size mismatch: {safe_name}")
            files[final_name] = body
            if executable:
                executable_paths.add(final_name)

    package = RegistrySkillPackage(
        files=files,
        executable_paths=executable_paths,
        version=version,
        archive_sha256=hashlib.sha256(archive).hexdigest(),
    )
    # Decode once during validation so malformed markdown never reaches the
    # preview cache or install transaction.
    _ = package.skill_markdown
    return package


class RegistryHub:
    """Aggregate extension search and install across multiple registry sources.

    Usage::

        hub = RegistryHub.from_config()
        results = hub.search("deep research")
        for r in results:
            print(r.name, r.source_type, r.source)
    """

    def __init__(self, registries: Optional[List[Dict[str, Any]]] = None) -> None:
        """Initialise with a list of registry config dicts.

        Each dict should have: ``name``, ``url``, ``type`` keys.
        When no ClawHub registry is present, a built-in ``clawhub.ai`` source is injected.
        """
        normalized, using_default = _ensure_clawhub_registry(list(registries or []))
        self._registries: List[Dict[str, Any]] = normalized
        self._using_default_clawhub = using_default

    @property
    def using_default_clawhub(self) -> bool:
        """True when the built-in ClawHub registry was injected from defaults."""
        return self._using_default_clawhub

    def source_name_for_type(self, source_type: str) -> str:
        """Return the first configured registry name for ``source_type``."""
        wanted = str(source_type or "").strip().lower()
        if not wanted:
            return ""
        for registry in self._registries:
            if (
                str(registry.get("type", "agx")).strip().lower() == wanted
                and str(registry.get("url", "")).strip()
            ):
                return str(registry.get("name", "")).strip()
        if wanted == "skillhub":
            return DEFAULT_SKILLHUB_REGISTRY["name"]
        return ""

    def source_type_for_name(self, source_name: str) -> str:
        """Return the configured registry type for ``source_name``."""
        wanted = str(source_name or "").strip()
        if not wanted:
            return ""
        for registry in self._registries:
            if str(registry.get("name", "")).strip() == wanted:
                return str(registry.get("type", "agx")).strip().lower()
        if wanted == DEFAULT_SKILLHUB_REGISTRY["name"]:
            return DEFAULT_SKILLHUB_REGISTRY["type"]
        return ""

    def _registry_for_source(self, source_name: str) -> Optional[Dict[str, Any]]:
        configured = next(
            (r for r in self._registries if r.get("name") == source_name),
            None,
        )
        if configured is not None:
            return configured
        if source_name == DEFAULT_SKILLHUB_REGISTRY["name"]:
            return dict(DEFAULT_SKILLHUB_REGISTRY)
        return None

    @classmethod
    def from_config(cls) -> "RegistryHub":
        """Build a RegistryHub from the user's ``~/.agenticx/config.yaml``."""
        try:
            from agenticx.cli.config_manager import ConfigManager

            raw = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
            extensions = raw.get("extensions") or {}
            registries = extensions.get("registries") or []
            if not isinstance(registries, list):
                registries = []
            return cls(registries=registries)
        except Exception as exc:
            logger.warning("Failed to load registry config: %s", exc)
            return cls(registries=[])

    def search(self, query: str = "") -> List[SearchResult]:
        """Search across all configured registries.

        Args:
            query: Search query string (empty returns all results).

        Returns:
            Deduplicated list of :class:`SearchResult` objects.
        """
        seen: set[str] = set()
        results: List[SearchResult] = []
        failed_sources: List[str] = []
        successful_sources = 0

        for reg in self._registries:
            reg_type = str(reg.get("type", "agx")).lower()
            reg_name = str(reg.get("name", ""))
            reg_url = str(reg.get("url", "")).rstrip("/")

            if not reg_url:
                continue

            try:
                if reg_type == "agx":
                    batch = self._search_agx(reg_url, reg_name, query)
                elif reg_type == "clawhub":
                    batch = self._search_clawhub(reg_url, reg_name, query)
                elif reg_type == "skillhub":
                    batch = self._search_skillhub(reg_url, reg_name, query)
                else:
                    logger.warning("Unknown registry type '%s'; skipping '%s'", reg_type, reg_name)
                    continue
                successful_sources += 1
            except Exception as exc:
                logger.warning("Search failed for registry '%s': %s", reg_name, exc)
                failed_sources.append(f"{reg_name}: {exc}")
                continue

            for result in batch:
                key = f"{result.source_type}:{result.name}"
                if key not in seen:
                    seen.add(key)
                    results.append(result)

        # If every configured source failed, surface an error to caller instead of
        # pretending this was a normal "no match" result.
        if not results and successful_sources == 0 and failed_sources:
            raise RuntimeError("All registry sources failed: " + " | ".join(failed_sources[:3]))

        return results

    def search_source(self, source_name: str, query: str = "") -> List[SearchResult]:
        """Search one configured or built-in marketplace source."""
        registry = self._registry_for_source(source_name)
        if registry is None:
            raise ValueError(f"Registry '{source_name}' not found in configuration")
        reg_type = str(registry.get("type", "agx")).strip().lower()
        reg_url = str(registry.get("url", "")).rstrip("/")
        if not reg_url:
            raise ValueError("Registry URL is empty")
        if reg_type == "agx":
            return self._search_agx(reg_url, source_name, query)
        if reg_type == "clawhub":
            return self._search_clawhub(reg_url, source_name, query)
        if reg_type == "skillhub":
            return self._search_skillhub(reg_url, source_name, query)
        raise ValueError(f"Search not supported for registry type '{reg_type}'")

    def _search_agx(self, url: str, source_name: str, query: str) -> List[SearchResult]:
        """Search an AGX native registry (GET /skills?q=...)."""
        import httpx

        params = {"q": query} if query else {}
        resp = httpx.get(
            f"{url}/skills", params=params, timeout=10.0, **_REGISTRY_HTTPX
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        results = []
        for item in items:
            if not isinstance(item, dict):
                continue
            results.append(
                SearchResult(
                    name=str(item.get("name", "")),
                    description=str(item.get("description", "")),
                    version=str(item.get("version", "0.1.0")),
                    author=str(item.get("author", "unknown")),
                    source=source_name,
                    source_type="agx",
                    install_hint=f"agx skills install {item.get('name', '')} --registry {url}",
                    extra=item,
                )
            )
        return results

    def _search_clawhub(self, url: str, source_name: str, query: str) -> List[SearchResult]:
        """Search ClawHub skills API.

        ClawHub currently exposes a unified search endpoint at
        GET /api/v1/search?q=... (with result records containing slug/displayName/summary).
        Some deployments also provide GET /api/v1/skills?q=... and/or /api/skills.
        Returns skill cards with name/description/author/downloads.
        """
        import httpx

        def _compute_wait(resp: httpx.Response) -> float:
            for hdr in ("retry-after", "ratelimit-reset", "x-ratelimit-reset"):
                raw = str(resp.headers.get(hdr, "")).strip()
                if not raw:
                    continue
                try:
                    val = float(raw)
                except Exception:
                    continue
                if val > 1_000_000_000:
                    return max(1.0, min(60.0, val - time.time()))
                return max(1.0, min(60.0, val))
            return 5.0

        def _get_with_retry(
            endpoint: str,
            *,
            params: Optional[Dict[str, Any]] = None,
            timeout: float = 10.0,
            attempts: int = 3,
        ) -> httpx.Response:
            last_resp: Optional[httpx.Response] = None
            for attempt in range(attempts):
                resp = httpx.get(endpoint, params=params, timeout=timeout, **_REGISTRY_HTTPX)
                last_resp = resp
                if resp.status_code != 429:
                    return resp
                if attempt < attempts - 1:
                    delay = _compute_wait(resp)
                    logger.info("ClawHub search 429 (attempt %d), sleeping %.1fs", attempt + 1, delay)
                    time.sleep(delay)
            assert last_resp is not None
            wait = int(_compute_wait(last_resp))
            raise RuntimeError(
                f"ClawHub search rate limited (429). Retry in about {wait}s."
            )

        q = (query or "").strip()
        params = {"q": q, "limit": "50"} if q else {"limit": "50"}
        payload: Dict[str, Any] = {}

        # Preferred endpoint: /v1/search (matches current clawhub.ai web behavior)
        if q:
            try:
                search_params = {"q": q, "type": "skill", "limit": "50"}
                resp = _get_with_retry(
                    f"{url}/v1/search", params=search_params, timeout=10.0
                )
                resp.raise_for_status()
                payload = resp.json()
            except RuntimeError:
                # Preserve explicit rate-limit errors for caller/UI.
                raise
            except Exception:
                payload = {}

        # Fallback to legacy list endpoints when search is unavailable or empty.
        if not payload:
            try:
                resp = httpx.get(
                    f"{url}/v1/skills", params=params, timeout=10.0, **_REGISTRY_HTTPX
                )
                resp.raise_for_status()
                payload = resp.json()
            except Exception:
                # Fallback: try /skills endpoint (some deployments differ)
                resp = httpx.get(
                    f"{url}/skills", params=params, timeout=10.0, **_REGISTRY_HTTPX
                )
                resp.raise_for_status()
                payload = resp.json()

        items = payload.get("results") or payload.get("items") or payload.get("skills") or []
        results = []
        for item in items:
            if not isinstance(item, dict):
                continue
            # Use slug as stable install identifier; displayName may contain spaces.
            name = str(item.get("slug") or item.get("name") or "")
            if not name:
                continue
            display_name = str(item.get("displayName") or "").strip()
            summary = str(item.get("summary") or item.get("description") or "").strip()
            description = summary
            if display_name and display_name.lower() != name.lower():
                description = f"{display_name} — {summary}" if summary else display_name
            results.append(
                SearchResult(
                    name=name,
                    description=description,
                    version=str(item.get("version") or "latest"),
                    author=str(item.get("author") or item.get("publisher") or "unknown"),
                    source=source_name,
                    source_type="clawhub",
                    install_hint=f"Download SKILL.md from ClawHub: {url}/skills/{name}",
                    extra=item,
                )
            )
        return results

    def _search_skillhub(self, url: str, source_name: str, query: str) -> List[SearchResult]:
        """Search SkillHub's native public API without invoking the local CLI."""
        import httpx

        base = url.rstrip("/")
        endpoint = f"{base}/search" if base.endswith("/v1") else f"{base}/v1/search"
        params: Dict[str, Any] = {"limit": "50"}
        q = str(query or "").strip()
        if q:
            params["q"] = q
        response = httpx.get(
            endpoint,
            params=params,
            timeout=15.0,
            follow_redirects=True,
            **_REGISTRY_HTTPX,
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("results") or payload.get("items") or []
        if not isinstance(rows, list):
            return []

        results: List[SearchResult] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            slug = str(row.get("slug") or row.get("name") or "").strip()
            if not slug:
                continue
            namespace = row.get("namespace") if isinstance(row.get("namespace"), dict) else {}
            author = str(
                row.get("owner_name")
                or row.get("author")
                or namespace.get("displayName")
                or "unknown"
            ).strip()
            display_name = str(row.get("displayName") or row.get("name") or slug).strip()
            description = str(
                row.get("description_zh")
                or row.get("summary")
                or row.get("description")
                or ""
            ).strip()
            results.append(
                SearchResult(
                    name=slug,
                    description=description,
                    version=str(row.get("version") or "latest"),
                    author=author or "unknown",
                    source=source_name,
                    source_type="skillhub",
                    install_hint=str(namespace.get("canonicalName") or slug),
                    extra={**row, "display_name": display_name},
                )
            )
        return results

    def install(
        self,
        source_name: str,
        skill_name: str,
        *,
        namespace: str = "",
    ) -> InstallResult:
        """Install a skill or bundle from a specific registry source.

        Currently supports:
          - AGX native registry: downloads SKILL.md via SkillRegistryClient
          - ClawHub: downloads and installs the complete skill ZIP
          - SkillHub: downloads and installs the complete namespaced skill ZIP

        Args:
            source_name: Registry ``name`` as configured in ``extensions.registries``.
            skill_name: Skill/bundle name to install.

        Returns:
            :class:`InstallResult` with success flag and installed_path.
        """
        reg = self._registry_for_source(source_name)
        if reg is None:
            return InstallResult(
                success=False,
                name=skill_name,
                error=f"Registry '{source_name}' not found in configuration",
            )

        reg_type = str(reg.get("type", "agx")).lower()
        reg_url = str(reg.get("url", "")).rstrip("/")

        try:
            if reg_type == "agx":
                return self._install_agx(reg_url, skill_name)
            elif reg_type == "clawhub":
                return self._install_clawhub(reg_url, skill_name)
            elif reg_type == "skillhub":
                return self._install_skillhub(
                    reg_url,
                    skill_name,
                    namespace=namespace,
                )
            else:
                return InstallResult(
                    success=False,
                    name=skill_name,
                    error=f"Install not supported for registry type '{reg_type}'",
                )
        except Exception as exc:
            return InstallResult(success=False, name=skill_name, error=str(exc))

    def fetch_skill_package(
        self,
        source_name: str,
        skill_name: str,
        *,
        namespace: str = "",
    ) -> Tuple[Optional[RegistrySkillPackage], str]:
        """Download one complete skill folder without writing it locally."""
        reg = self._registry_for_source(source_name)
        if reg is None:
            return None, f"Registry '{source_name}' not found in configuration"

        reg_type = str(reg.get("type", "agx")).lower()
        reg_url = str(reg.get("url", "")).rstrip("/")
        if not reg_url:
            return None, "Registry URL is empty"

        try:
            if reg_type == "agx":
                content, error = self._fetch_agx_markdown(reg_url, skill_name)
                if error or content is None:
                    return None, error or "fetch failed"
                return RegistrySkillPackage(
                    files={"SKILL.md": content.encode("utf-8")}
                ), ""
            if reg_type == "clawhub":
                return self._fetch_clawhub_package(reg_url, skill_name)
            if reg_type == "skillhub":
                return self._fetch_skillhub_package(
                    reg_url,
                    skill_name,
                    namespace=namespace,
                )
            return None, f"Fetch not supported for registry type '{reg_type}'"
        except Exception as exc:
            return None, str(exc)

    def fetch_skill_markdown(
        self,
        source_name: str,
        skill_name: str,
        *,
        namespace: str = "",
    ) -> Tuple[Optional[str], str]:
        """Download SKILL.md without writing it (backward-compatible helper)."""
        package, error = self.fetch_skill_package(
            source_name,
            skill_name,
            namespace=namespace,
        )
        if error or package is None:
            return None, error or "fetch failed"
        try:
            return package.skill_markdown, ""
        except ValueError as exc:
            return None, str(exc)

    def _fetch_agx_markdown(self, url: str, skill_name: str) -> Tuple[Optional[str], str]:
        from agenticx.skills.registry import SkillRegistryClient

        client = SkillRegistryClient(registry_url=url)
        entry = client.get(skill_name)
        text = str(entry.skill_content or "").strip()
        if not text:
            return None, "Empty skill content from registry"
        return text, ""

    def _fetch_clawhub_package(
        self,
        url: str,
        skill_name: str,
        *,
        namespace: str = "",
        service_name: str = "ClawHub",
    ) -> Tuple[Optional[RegistrySkillPackage], str]:
        """Download and validate one complete marketplace ZIP."""
        import httpx

        def _compute_429_wait(resp: httpx.Response) -> float:
            """Derive wait seconds from ClawHub rate-limit headers.

            ClawHub uses ``ratelimit-reset`` (Unix epoch) and ``x-ratelimit-reset``
            rather than ``retry-after``.  Fall back to exponential backoff when the
            header is missing or unparseable.
            """
            for hdr in ("retry-after", "ratelimit-reset", "x-ratelimit-reset"):
                raw = str(resp.headers.get(hdr, "")).strip()
                if not raw:
                    continue
                try:
                    val = float(raw)
                except Exception:
                    continue
                if val > 1_000_000_000:
                    return max(1.0, min(60.0, val - time.time()))
                return max(1.0, min(60.0, val))
            return 5.0

        def _rate_limited_err(resp: httpx.Response) -> str:
            wait = int(_compute_429_wait(resp))
            return f"{service_name} API rate limited (429). Please retry in about {wait}s."

        try:
            base = url.rstrip("/")
            endpoint = f"{base}/download" if base.endswith("/v1") else f"{base}/v1/download"
            download_params = {"slug": skill_name}
            if namespace:
                download_params["namespace"] = namespace
            attempts = 2
            for attempt in range(attempts):
                retry_delay = 0.0
                with httpx.stream(
                    "GET",
                    endpoint,
                    params=download_params,
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    follow_redirects=True,
                    **_REGISTRY_HTTPX,
                ) as response:
                    if response.status_code == 429:
                        if attempt == attempts - 1:
                            return None, _rate_limited_err(response)
                        retry_delay = min(10.0, _compute_429_wait(response))
                    else:
                        response.raise_for_status()
                        raw_length = str(response.headers.get("content-length", "")).strip()
                        if raw_length:
                            try:
                                if int(raw_length) > MAX_SKILL_ARCHIVE_BYTES:
                                    return None, f"{service_name} skill package exceeds 50 MB"
                            except ValueError:
                                pass
                        chunks: list[bytes] = []
                        received = 0
                        for chunk in response.iter_bytes():
                            received += len(chunk)
                            if received > MAX_SKILL_ARCHIVE_BYTES:
                                return None, f"{service_name} skill package exceeds 50 MB"
                            chunks.append(chunk)
                        archive = b"".join(chunks)
                        dispositions = [
                            str(candidate.headers.get("content-disposition", ""))
                            for candidate in [response, *response.history]
                        ]
                        disposition = " ".join(value for value in dispositions if value)
                        version_match = re.search(
                            rf'{re.escape(skill_name)}-([0-9][A-Za-z0-9.+-]*)\.zip',
                            disposition,
                            flags=re.IGNORECASE,
                        )
                        version = version_match.group(1) if version_match else ""
                        return _skill_package_from_zip(archive, version=version), ""
                if retry_delay:
                    logger.info(
                        "%s download 429 (attempt %d), sleeping %.1fs",
                        service_name,
                        attempt + 1,
                        retry_delay,
                    )
                    time.sleep(retry_delay)
            return None, f"{service_name} skill download failed"
        except Exception as exc:
            return None, f"Failed to fetch skill from {service_name}: {exc}"

    def _fetch_skillhub_package(
        self,
        url: str,
        skill_name: str,
        *,
        namespace: str = "",
    ) -> Tuple[Optional[RegistrySkillPackage], str]:
        """Download a native SkillHub package, preserving its namespace."""
        package, error = self._fetch_clawhub_package(
            url,
            skill_name,
            namespace=namespace,
            service_name="SkillHub",
        )
        if package is not None:
            package.namespace = namespace
        return package, error

    def _fetch_clawhub_markdown(self, url: str, skill_name: str) -> Tuple[Optional[str], str]:
        """Backward-compatible SKILL.md-only view over the package download."""
        package, error = self._fetch_clawhub_package(url, skill_name)
        if error or package is None:
            return None, error or "fetch failed"
        try:
            return package.skill_markdown, ""
        except ValueError as exc:
            return None, str(exc)

    def write_registry_skill(
        self,
        skill_name: str,
        skill_content: str,
        *,
        source: str = "registry",
        install_root: Optional[Path] = None,
    ) -> Path:
        """Write a single-file skill (backward-compatible package wrapper)."""
        package = RegistrySkillPackage(
            files={"SKILL.md": skill_content.encode("utf-8")}
        )
        return self.write_registry_skill_package(
            skill_name,
            package,
            source=source,
            install_root=install_root,
        )

    def write_registry_skill_package(
        self,
        skill_name: str,
        package: RegistrySkillPackage,
        *,
        source: str = "registry",
        install_root: Optional[Path] = None,
    ) -> Path:
        """Atomically install a complete skill folder with rollback on failure."""
        from agenticx.skills.frontmatter import ensure_skill_source, write_skill_provenance
        from agenticx.skills.registry import _validate_skill_name

        validated = _validate_skill_name(skill_name)
        root = (
            Path(install_root)
            if install_root is not None
            else Path.home() / ".agenticx" / "skills" / "registry"
        ).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        root = root.resolve()
        candidate = root / validated
        if candidate.is_symlink():
            raise ValueError(f"Refusing to replace symlinked skill directory: {validated}")
        skill_dir = candidate.resolve(strict=False)
        skill_dir.relative_to(root)
        if skill_dir == root:
            raise ValueError("Invalid skill install directory")
        if skill_dir.exists() and not skill_dir.is_dir():
            raise ValueError(f"Skill install target is not a directory: {validated}")

        stage_dir = Path(
            tempfile.mkdtemp(prefix=f".{validated}.install-", dir=str(root))
        )
        backup_dir = root / f".{validated}.backup-{uuid.uuid4().hex}"
        moved_existing = False
        installed = False
        try:
            staged_md = package.materialize(stage_dir)
            stamped = ensure_skill_source(staged_md.read_text(encoding="utf-8"), source)
            staged_md.write_text(stamped, encoding="utf-8")
            provenance_extra: Dict[str, Any] = {
                "name": validated,
                "file_count": len(package.files),
            }
            if package.version:
                provenance_extra["version"] = package.version
            if package.namespace:
                provenance_extra["namespace"] = package.namespace
            if package.archive_sha256:
                provenance_extra["archive_sha256"] = package.archive_sha256
            write_skill_provenance(
                stage_dir,
                source,
                extra=provenance_extra,
            )

            if skill_dir.exists():
                os.replace(skill_dir, backup_dir)
                moved_existing = True
            try:
                os.replace(stage_dir, skill_dir)
                installed = True
            except Exception:
                if moved_existing and backup_dir.exists() and not skill_dir.exists():
                    os.replace(backup_dir, skill_dir)
                    moved_existing = False
                raise
        finally:
            if stage_dir.exists():
                shutil.rmtree(stage_dir, ignore_errors=True)
            if installed and backup_dir.exists():
                try:
                    shutil.rmtree(backup_dir)
                except OSError as exc:
                    logger.warning("Failed to remove skill install backup %s: %s", backup_dir, exc)
            elif moved_existing and backup_dir.exists() and not skill_dir.exists():
                os.replace(backup_dir, skill_dir)

        return skill_dir / "SKILL.md"

    def _install_agx(self, url: str, skill_name: str) -> InstallResult:
        """Install from an AGX native registry via SkillRegistryClient."""
        content, err = self._fetch_agx_markdown(url, skill_name)
        if err or content is None:
            return InstallResult(success=False, name=skill_name, error=err or "fetch failed")
        md_path = self.write_registry_skill(skill_name, content)
        return InstallResult(
            success=True,
            name=skill_name,
            installed_path=str(md_path),
        )

    def _install_clawhub(self, url: str, skill_name: str) -> InstallResult:
        """Install a complete ClawHub skill package."""
        package, err = self._fetch_clawhub_package(url, skill_name)
        if err or package is None:
            return InstallResult(success=False, name=skill_name, error=err or "fetch failed")
        md_path = self.write_registry_skill_package(skill_name, package)
        return InstallResult(
            success=True,
            name=skill_name,
            installed_path=str(md_path),
        )

    def _install_skillhub(
        self,
        url: str,
        skill_name: str,
        *,
        namespace: str = "",
    ) -> InstallResult:
        """Install a complete SkillHub package from its native API."""
        package, err = self._fetch_skillhub_package(
            url,
            skill_name,
            namespace=namespace,
        )
        if err or package is None:
            return InstallResult(success=False, name=skill_name, error=err or "fetch failed")
        md_path = self.write_registry_skill_package(
            skill_name,
            package,
            source="skillhub",
        )
        return InstallResult(
            success=True,
            name=skill_name,
            installed_path=str(md_path),
        )
