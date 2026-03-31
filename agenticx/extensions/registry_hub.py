#!/usr/bin/env python3
"""RegistryHub — aggregate search across multiple AGX extension registries.

Supports three registry types:
  - ``agx``: AgenticX native registry (compatible with agenticx.skills.registry REST API)
  - ``clawhub``: ClawHub API adapter (read-only search, installs via Skill.md download)
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

import logging
import io
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Registry hosts are public HTTPS endpoints; do not inherit HTTP(S)_PROXY or SOCKS
# from the environment (SOCKS without socksio breaks httpx; proxies often break TLS).
_REGISTRY_HTTPX = {"trust_env": False}


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
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "source": self.source,
            "source_type": self.source_type,
            "install_hint": self.install_hint,
        }


@dataclass
class InstallResult:
    """Result of an install-from-registry operation."""

    success: bool
    name: str = ""
    error: str = ""
    installed_path: str = ""
    scan_summary: Optional[Dict[str, Any]] = None
    error_code: Optional[str] = None


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
        """
        self._registries: List[Dict[str, Any]] = registries or []

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

    def install(self, source_name: str, skill_name: str) -> InstallResult:
        """Install a skill or bundle from a specific registry source.

        Currently supports:
          - AGX native registry: downloads SKILL.md via SkillRegistryClient.install()
          - ClawHub: downloads SKILL.md from ClawHub API

        Args:
            source_name: Registry ``name`` as configured in ``extensions.registries``.
            skill_name: Skill/bundle name to install.

        Returns:
            :class:`InstallResult` with success flag and installed_path.
        """
        reg = next(
            (r for r in self._registries if r.get("name") == source_name), None
        )
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
            else:
                return InstallResult(
                    success=False,
                    name=skill_name,
                    error=f"Install not supported for registry type '{reg_type}'",
                )
        except Exception as exc:
            return InstallResult(success=False, name=skill_name, error=str(exc))

    def fetch_skill_markdown(self, source_name: str, skill_name: str) -> Tuple[Optional[str], str]:
        """Download SKILL.md body without writing to the skills registry.

        Returns:
            Tuple of (content or None, error message — empty string on success).
        """
        reg = next(
            (r for r in self._registries if r.get("name") == source_name), None
        )
        if reg is None:
            return None, f"Registry '{source_name}' not found in configuration"

        reg_type = str(reg.get("type", "agx")).lower()
        reg_url = str(reg.get("url", "")).rstrip("/")
        if not reg_url:
            return None, "Registry URL is empty"

        try:
            if reg_type == "agx":
                return self._fetch_agx_markdown(reg_url, skill_name)
            if reg_type == "clawhub":
                return self._fetch_clawhub_markdown(reg_url, skill_name)
            return None, f"Fetch not supported for registry type '{reg_type}'"
        except Exception as exc:
            return None, str(exc)

    def _fetch_agx_markdown(self, url: str, skill_name: str) -> Tuple[Optional[str], str]:
        from agenticx.skills.registry import SkillRegistryClient

        client = SkillRegistryClient(registry_url=url)
        entry = client.get(skill_name)
        text = str(entry.skill_content or "").strip()
        if not text:
            return None, "Empty skill content from registry"
        return text, ""

    def _fetch_clawhub_markdown(self, url: str, skill_name: str) -> Tuple[Optional[str], str]:
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
            return f"ClawHub API rate limited (429). Please retry in about {wait}s."

        def _get_with_retry(
            endpoint: str,
            *,
            params: Optional[Dict[str, Any]] = None,
            timeout: float = 15.0,
            attempts: int = 3,
        ) -> Tuple[Optional[httpx.Response], str]:
            last_resp: Optional[httpx.Response] = None
            for attempt in range(attempts):
                resp = httpx.get(
                    endpoint,
                    params=params,
                    timeout=timeout,
                    **_REGISTRY_HTTPX,
                )
                last_resp = resp
                if resp.status_code != 429:
                    return resp, ""
                if attempt < attempts - 1:
                    delay = _compute_429_wait(resp)
                    logger.info("ClawHub 429 on %s (attempt %d), sleeping %.1fs", endpoint, attempt + 1, delay)
                    time.sleep(delay)
            assert last_resp is not None
            return None, _rate_limited_err(last_resp)

        # Step 1: Fetch version list to get the latest version tag.
        # The /v1/skills/{slug} detail endpoint only returns metadata (no SKILL.md content),
        # so we skip that request and go straight to the versions endpoint.
        try:
            versions_resp, limited_err = _get_with_retry(
                f"{url}/v1/packages/{skill_name}/versions",
                timeout=15.0,
            )
            if limited_err:
                return None, limited_err
            assert versions_resp is not None
            versions_resp.raise_for_status()
            versions_payload = versions_resp.json()
            versions = versions_payload.get("items") or []
            if not isinstance(versions, list) or not versions:
                return None, "No package versions returned from ClawHub API"
            latest_version = str((versions[0] or {}).get("version") or "").strip()
            if not latest_version:
                return None, "Missing latest version in ClawHub package metadata"

            # Step 2: Fetch the specific version detail to get the SKILL.md file hash.
            version_resp, limited_err = _get_with_retry(
                f"{url}/v1/packages/{skill_name}/versions/{latest_version}",
                timeout=15.0,
            )
            if limited_err:
                return None, limited_err
            assert version_resp is not None
            version_resp.raise_for_status()
            version_payload = version_resp.json()
            files = (version_payload.get("version") or {}).get("files") or []
            if not isinstance(files, list):
                files = []

            skill_file_hash = ""
            for f in files:
                if not isinstance(f, dict):
                    continue
                if str(f.get("path", "")).strip().upper() == "SKILL.MD":
                    skill_file_hash = str(f.get("sha256") or "").strip()
                    break
            if not skill_file_hash:
                return None, "SKILL.md hash not found in ClawHub package files"

            # Step 3: Download the SKILL.md (ClawHub returns a zip archive).
            download_resp, limited_err = _get_with_retry(
                f"{url}/v1/download",
                params={"slug": skill_name, "hash": skill_file_hash, "file": "SKILL.md"},
                timeout=20.0,
            )
            if limited_err:
                return None, limited_err
            assert download_resp is not None
            download_resp.raise_for_status()

            content_type = str(download_resp.headers.get("content-type", "")).lower()
            if "zip" in content_type or download_resp.content.startswith(b"PK\x03\x04"):
                with zipfile.ZipFile(io.BytesIO(download_resp.content)) as zf:
                    for member in zf.namelist():
                        if member.strip().upper().endswith("SKILL.MD"):
                            return zf.read(member).decode("utf-8", errors="replace"), ""
                return None, "Downloaded package zip does not contain SKILL.md"

            # Fallback: some deployments may return raw markdown/plain text directly.
            text = download_resp.text
            if text.strip():
                return text, ""
            return None, "Downloaded SKILL.md content is empty"
        except Exception as exc:
            return None, f"Failed to fetch skill from ClawHub: {exc}"

    def write_registry_skill(self, skill_name: str, skill_content: str) -> Path:
        """Write SKILL.md under ~/.agenticx/skills/registry/<name>/."""
        from agenticx.skills.registry import _validate_skill_name

        validated = _validate_skill_name(skill_name)
        install_root = Path.home() / ".agenticx" / "skills" / "registry"
        install_root = install_root.resolve()
        skill_dir = (install_root / validated).resolve()
        skill_dir.relative_to(install_root)
        skill_dir.mkdir(parents=True, exist_ok=True)
        md_path = skill_dir / "SKILL.md"
        md_path.write_text(skill_content, encoding="utf-8")
        return md_path

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
        """Install a ClawHub skill by fetching its SKILL.md content."""
        content, err = self._fetch_clawhub_markdown(url, skill_name)
        if err or content is None:
            return InstallResult(success=False, name=skill_name, error=err or "fetch failed")
        md_path = self.write_registry_skill(skill_name, content)
        return InstallResult(
            success=True,
            name=skill_name,
            installed_path=str(md_path),
        )
