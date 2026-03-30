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
          url: https://clawhub.com/api
          type: clawhub
      scan_dirs:
        - ~/.agenticx/bundles
        - ~/.agenticx/skills/registry

Author: Damon Li
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


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
            except Exception as exc:
                logger.warning("Search failed for registry '%s': %s", reg_name, exc)
                continue

            for result in batch:
                key = f"{result.source_type}:{result.name}"
                if key not in seen:
                    seen.add(key)
                    results.append(result)

        return results

    def _search_agx(self, url: str, source_name: str, query: str) -> List[SearchResult]:
        """Search an AGX native registry (GET /skills?q=...)."""
        import httpx

        params = {"q": query} if query else {}
        resp = httpx.get(f"{url}/skills", params=params, timeout=10.0)
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

        ClawHub exposes a search endpoint at GET /api/v1/skills?q=...
        Returns skill cards with name/description/author/downloads.
        """
        import httpx

        params = {"q": query, "limit": "50"} if query else {"limit": "50"}
        try:
            resp = httpx.get(f"{url}/v1/skills", params=params, timeout=10.0)
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            # Fallback: try /skills endpoint (some deployments differ)
            resp = httpx.get(f"{url}/skills", params=params, timeout=10.0)
            resp.raise_for_status()
            payload = resp.json()

        items = payload.get("items") or payload.get("skills") or []
        results = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("slug") or "")
            if not name:
                continue
            results.append(
                SearchResult(
                    name=name,
                    description=str(item.get("description") or item.get("summary") or ""),
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

        try:
            resp = httpx.get(f"{url}/v1/skills/{skill_name}", timeout=15.0)
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            resp = httpx.get(f"{url}/skills/{skill_name}", timeout=15.0)
            resp.raise_for_status()
            payload = resp.json()

        skill_content = str(
            payload.get("skill_content")
            or payload.get("content")
            or payload.get("md_content")
            or ""
        )
        if not skill_content.strip():
            return None, "No skill_content returned from ClawHub API"
        return skill_content, ""

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
