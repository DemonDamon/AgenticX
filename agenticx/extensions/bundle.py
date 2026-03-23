#!/usr/bin/env python3
"""AGX Bundle manifest definition and parser.

An AGX Bundle is a distributable package that can contain any combination of:
  - Skills (SKILL.md files with knowledge instructions)
  - MCP server configs (JSON configs for tool capability extension)
  - Avatar presets (YAML configs for agent persona presets)
  - Memory templates (Markdown templates for memory pipeline)

Bundle layout::

    my-bundle/
    ├── agx-bundle.yaml          # Required manifest
    ├── skills/
    │   └── research-sop/
    │       └── SKILL.md
    ├── mcp/
    │   └── web-crawler.json
    ├── avatars/
    │   └── researcher.yaml
    └── memory/
        └── research-workflow.md

Manifest format (agx-bundle.yaml)::

    agx_bundle: "1.0"
    name: "deep-research-kit"
    version: "1.0.0"
    description: "Complete deep research toolkit"
    author: "Damon Li"
    license: "MIT"

    components:
      skills:
        - path: skills/research-sop/SKILL.md
          description: "Deep research SOP skill"
      mcp_servers:
        - name: "web-crawler"
          config_path: mcp/web-crawler.json
          description: "MCP server for web crawling"
      avatars:
        - name: "researcher"
          config_path: avatars/researcher.yaml
          description: "Research specialist avatar preset"
      memory_templates:
        - name: "research-workflow"
          path: memory/research-workflow.md
          description: "Memory template for research sessions"

Author: Damon Li
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "agx-bundle.yaml"
SUPPORTED_FORMAT_VERSIONS = {"1.0", "1"}


class BundleParseError(ValueError):
    """Raised when an AGX Bundle manifest cannot be parsed."""


@dataclass
class BundleSkillRef:
    """Reference to a skill within a bundle."""

    path: str
    description: str = ""

    def resolved_path(self, bundle_dir: Path) -> Path:
        return bundle_dir / self.path


@dataclass
class BundleMcpRef:
    """Reference to an MCP server config within a bundle."""

    name: str
    config_path: str
    description: str = ""

    def resolved_config_path(self, bundle_dir: Path) -> Path:
        return bundle_dir / self.config_path


@dataclass
class BundleAvatarRef:
    """Reference to an avatar preset within a bundle."""

    name: str
    config_path: str
    description: str = ""

    def resolved_config_path(self, bundle_dir: Path) -> Path:
        return bundle_dir / self.config_path


@dataclass
class BundleMemoryRef:
    """Reference to a memory template within a bundle."""

    name: str
    path: str
    description: str = ""

    def resolved_path(self, bundle_dir: Path) -> Path:
        return bundle_dir / self.path


@dataclass
class BundleManifest:
    """Parsed AGX Bundle manifest.

    Attributes:
        name: Bundle identifier (used in install paths and bundles.json).
        version: Semantic version string.
        description: Human-readable description.
        author: Bundle author.
        license: SPDX license identifier or free text.
        format_version: agx_bundle manifest format version (e.g. "1.0").
        skills: Skill component references.
        mcp_servers: MCP server component references.
        avatars: Avatar preset component references.
        memory_templates: Memory template component references.
        source_dir: Absolute path to the bundle directory on disk.
    """

    name: str
    version: str
    description: str
    author: str
    license: str
    format_version: str
    skills: List[BundleSkillRef]
    mcp_servers: List[BundleMcpRef]
    avatars: List[BundleAvatarRef]
    memory_templates: List[BundleMemoryRef]
    source_dir: Path

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "license": self.license,
            "format_version": self.format_version,
            "source_dir": str(self.source_dir),
            "components": {
                "skills": [{"path": s.path, "description": s.description} for s in self.skills],
                "mcp_servers": [
                    {"name": m.name, "config_path": m.config_path, "description": m.description}
                    for m in self.mcp_servers
                ],
                "avatars": [
                    {"name": a.name, "config_path": a.config_path, "description": a.description}
                    for a in self.avatars
                ],
                "memory_templates": [
                    {"name": t.name, "path": t.path, "description": t.description}
                    for t in self.memory_templates
                ],
            },
        }


def _safe_str(value: Any, default: str = "") -> str:
    """Coerce to string, return default on None or non-string."""
    if value is None:
        return default
    return str(value).strip() or default


def _validate_relative_path(raw_path: str, bundle_dir: Path, field_name: str) -> str:
    """Validate that a path is relative and does not escape the bundle directory.

    Returns the normalised relative path string.
    Raises BundleParseError on invalid paths.
    """
    if not raw_path:
        raise BundleParseError(f"Empty path in field '{field_name}'")

    p = Path(raw_path)
    if p.is_absolute():
        raise BundleParseError(
            f"Field '{field_name}' must be a relative path, got absolute: {raw_path!r}"
        )

    resolved = (bundle_dir / p).resolve()
    try:
        resolved.relative_to(bundle_dir.resolve())
    except ValueError:
        raise BundleParseError(
            f"Field '{field_name}' path escapes bundle directory: {raw_path!r}"
        )

    return raw_path


def _parse_skills(raw: Any, bundle_dir: Path) -> List[BundleSkillRef]:
    if not raw:
        return []
    if not isinstance(raw, list):
        logger.warning("components.skills must be a list; ignoring")
        return []
    refs: List[BundleSkillRef] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning("skills[%d] is not a dict; skipping", idx)
            continue
        raw_path = _safe_str(item.get("path"))
        try:
            path = _validate_relative_path(raw_path, bundle_dir, f"skills[{idx}].path")
        except BundleParseError as exc:
            logger.warning("Skipping skill entry %d: %s", idx, exc)
            continue
        refs.append(BundleSkillRef(path=path, description=_safe_str(item.get("description"))))
    return refs


def _parse_mcp_servers(raw: Any, bundle_dir: Path) -> List[BundleMcpRef]:
    if not raw:
        return []
    if not isinstance(raw, list):
        logger.warning("components.mcp_servers must be a list; ignoring")
        return []
    refs: List[BundleMcpRef] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning("mcp_servers[%d] is not a dict; skipping", idx)
            continue
        name = _safe_str(item.get("name"))
        raw_path = _safe_str(item.get("config_path"))
        if not name:
            logger.warning("mcp_servers[%d] missing 'name'; skipping", idx)
            continue
        try:
            config_path = _validate_relative_path(
                raw_path, bundle_dir, f"mcp_servers[{idx}].config_path"
            )
        except BundleParseError as exc:
            logger.warning("Skipping mcp_server entry %d: %s", idx, exc)
            continue
        refs.append(
            BundleMcpRef(
                name=name,
                config_path=config_path,
                description=_safe_str(item.get("description")),
            )
        )
    return refs


def _parse_avatars(raw: Any, bundle_dir: Path) -> List[BundleAvatarRef]:
    if not raw:
        return []
    if not isinstance(raw, list):
        logger.warning("components.avatars must be a list; ignoring")
        return []
    refs: List[BundleAvatarRef] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning("avatars[%d] is not a dict; skipping", idx)
            continue
        name = _safe_str(item.get("name"))
        raw_path = _safe_str(item.get("config_path"))
        if not name:
            logger.warning("avatars[%d] missing 'name'; skipping", idx)
            continue
        try:
            config_path = _validate_relative_path(
                raw_path, bundle_dir, f"avatars[{idx}].config_path"
            )
        except BundleParseError as exc:
            logger.warning("Skipping avatar entry %d: %s", idx, exc)
            continue
        refs.append(
            BundleAvatarRef(
                name=name,
                config_path=config_path,
                description=_safe_str(item.get("description")),
            )
        )
    return refs


def _parse_memory_templates(raw: Any, bundle_dir: Path) -> List[BundleMemoryRef]:
    if not raw:
        return []
    if not isinstance(raw, list):
        logger.warning("components.memory_templates must be a list; ignoring")
        return []
    refs: List[BundleMemoryRef] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning("memory_templates[%d] is not a dict; skipping", idx)
            continue
        name = _safe_str(item.get("name"))
        raw_path = _safe_str(item.get("path"))
        if not name:
            logger.warning("memory_templates[%d] missing 'name'; skipping", idx)
            continue
        try:
            path = _validate_relative_path(
                raw_path, bundle_dir, f"memory_templates[{idx}].path"
            )
        except BundleParseError as exc:
            logger.warning("Skipping memory_template entry %d: %s", idx, exc)
            continue
        refs.append(
            BundleMemoryRef(
                name=name,
                path=path,
                description=_safe_str(item.get("description")),
            )
        )
    return refs


def parse_bundle_manifest(bundle_dir: Path) -> BundleManifest:
    """Parse an AGX Bundle manifest from a directory.

    Args:
        bundle_dir: Path to the directory containing ``agx-bundle.yaml``.

    Returns:
        Parsed :class:`BundleManifest`.

    Raises:
        BundleParseError: On missing manifest, unsupported format, or invalid content.
        FileNotFoundError: If ``bundle_dir`` does not exist.
    """
    bundle_dir = bundle_dir.resolve()
    if not bundle_dir.exists():
        raise FileNotFoundError(f"Bundle directory not found: {bundle_dir}")
    if not bundle_dir.is_dir():
        raise BundleParseError(f"Not a directory: {bundle_dir}")

    manifest_path = bundle_dir / MANIFEST_FILENAME
    if not manifest_path.exists():
        raise BundleParseError(
            f"No '{MANIFEST_FILENAME}' found in {bundle_dir}. "
            "This does not appear to be an AGX Bundle."
        )

    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError as exc:
        raise BundleParseError("PyYAML is required to parse AGX bundles") from exc

    try:
        raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise BundleParseError(f"Failed to parse YAML manifest: {exc}") from exc

    if not isinstance(raw, dict):
        raise BundleParseError(f"'{MANIFEST_FILENAME}' must be a YAML mapping, got {type(raw).__name__}")

    fmt_version = _safe_str(raw.get("agx_bundle"), "")
    if not fmt_version:
        raise BundleParseError(
            f"'{MANIFEST_FILENAME}' missing required field 'agx_bundle' (format version)"
        )
    if fmt_version not in SUPPORTED_FORMAT_VERSIONS:
        raise BundleParseError(
            f"Unsupported bundle format version '{fmt_version}'. "
            f"Supported: {sorted(SUPPORTED_FORMAT_VERSIONS)}"
        )

    name = _safe_str(raw.get("name"))
    if not name:
        raise BundleParseError(f"'{MANIFEST_FILENAME}' missing required field 'name'")

    version = _safe_str(raw.get("version"), "0.1.0")
    description = _safe_str(raw.get("description"))
    author = _safe_str(raw.get("author"), "unknown")
    license_str = _safe_str(raw.get("license"), "")

    components = raw.get("components") or {}
    if not isinstance(components, dict):
        components = {}

    skills = _parse_skills(components.get("skills"), bundle_dir)
    mcp_servers = _parse_mcp_servers(components.get("mcp_servers"), bundle_dir)
    avatars = _parse_avatars(components.get("avatars"), bundle_dir)
    memory_templates = _parse_memory_templates(components.get("memory_templates"), bundle_dir)

    logger.info(
        "Parsed AGX Bundle '%s' v%s from %s "
        "(skills=%d, mcp=%d, avatars=%d, memory=%d)",
        name,
        version,
        bundle_dir,
        len(skills),
        len(mcp_servers),
        len(avatars),
        len(memory_templates),
    )

    return BundleManifest(
        name=name,
        version=version,
        description=description,
        author=author,
        license=license_str,
        format_version=fmt_version,
        skills=skills,
        mcp_servers=mcp_servers,
        avatars=avatars,
        memory_templates=memory_templates,
        source_dir=bundle_dir,
    )
