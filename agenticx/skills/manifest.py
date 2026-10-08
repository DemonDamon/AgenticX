#!/usr/bin/env python3
"""Skills over MCP (io.modelcontextprotocol/skills) wire models and integrity checks.

Implements the ``Skill`` entry shape defined by the MCP Skills extension
(SEP-2640) plus the host-side verification primitives:

- :class:`SkillFileEntry` / :class:`SkillManifest` — the protocol entry models
  (``resources`` is the wire name for the file manifest).
- :func:`verify_file` / :func:`verify_frontmatter` — reading-point integrity
  checks (digest + size + frontmatter comparison) per the spec's
  "Integrity and Verification" section.

Skill identity is the pair (server identity, URI); ``name`` is only a label.
See plans/mcp-skills/MASTER-PLAN.md for the engineering constraints.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

# Extension identifier from the spec.
SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills"

# SHOULD-level limits from the spec (servers should not exceed; hosts must support).
MAX_SKILL_FILES = 512
MAX_SKILL_BYTES = 16 * 1024 * 1024

_DIGEST_PREFIX = "sha256:"


class SkillIntegrityError(Exception):
    """A skill file or manifest failed digest/size/frontmatter verification."""

    def __init__(self, uri: str, reason: str) -> None:
        self.uri = uri
        self.reason = reason
        super().__init__(f"skill integrity failure for {uri!r}: {reason}")


class SkillExtensionNotDeclaredError(Exception):
    """The server did not declare the skills extension in its capabilities."""


class SkillNotFoundError(Exception):
    """The server answered skills/get with -32602 (unknown skill URI)."""


class SkillManifestError(Exception):
    """A skills/list / skills/get entry could not be parsed into a manifest."""


class SkillFileEntry(BaseModel):
    """One file of a skill: URI + SHA-256 digest + byte size (wire: ``SkillResource``)."""

    uri: str
    digest: str = Field(description="SHA-256 of raw bytes, formatted ``sha256:<hex>``.")
    size: int = Field(ge=0, description="Length in bytes of the raw content.")
    model_config = ConfigDict(extra="allow")

    def digest_hex(self) -> str:
        if self.digest.startswith(_DIGEST_PREFIX):
            return self.digest[len(_DIGEST_PREFIX):]
        return self.digest


class SkillManifest(BaseModel):
    """The entry for one skill as returned by ``skills/list`` / ``skills/get``."""

    uri: str = Field(description="Resource URI of the skill's SKILL.md.")
    frontmatter: Dict[str, Any] = Field(default_factory=dict)
    resources: Union[List[SkillFileEntry], Literal["dynamic"]] = Field(
        description="Complete file manifest, or the string 'dynamic'."
    )
    resultType: Optional[str] = None
    ttlMs: Optional[int] = None
    cacheScope: Optional[str] = None
    model_config = ConfigDict(extra="allow")

    # ------------------------------------------------------------------ helpers

    @classmethod
    def from_skill_entry(cls, data: Any) -> "SkillManifest":
        """Parse one entry (dict or wire model) from ``skills/list`` / ``skills/get``."""
        if isinstance(data, SkillManifest):
            return data
        if isinstance(data, BaseModel):
            data = data.model_dump(by_alias=True, mode="json", exclude_none=True)
        if not isinstance(data, dict):
            raise SkillManifestError(f"skill entry must be a dict, got {type(data).__name__}")
        uri = data.get("uri")
        if not uri or not isinstance(uri, str):
            raise SkillManifestError("skill entry missing 'uri'")
        frontmatter = data.get("frontmatter")
        if not isinstance(frontmatter, dict):
            raise SkillManifestError(f"skill entry {uri!r} missing 'frontmatter' object")
        resources = data.get("resources", data.get("files"))
        if resources == "dynamic":
            pass
        elif isinstance(resources, list):
            parsed: List[SkillFileEntry] = []
            for item in resources:
                if not isinstance(item, dict):
                    raise SkillManifestError(f"skill entry {uri!r} has malformed resource entry")
                try:
                    parsed.append(SkillFileEntry.model_validate(item))
                except Exception as exc:
                    raise SkillManifestError(
                        f"skill entry {uri!r} has invalid resource entry {item.get('uri')!r}: {exc}"
                    ) from exc
            resources = parsed
        elif resources is None:
            raise SkillManifestError(f"skill entry {uri!r} missing 'resources' manifest")
        else:
            raise SkillManifestError(f"skill entry {uri!r} has malformed 'resources'")
        return cls(
            uri=uri,
            frontmatter=frontmatter,
            resources=resources,
            resultType=data.get("resultType"),
            ttlMs=data.get("ttlMs"),
            cacheScope=data.get("cacheScope"),
        )

    @property
    def name(self) -> str:
        """Skill name label (frontmatter ``name``; falls back to URI segment)."""
        fm_name = self.frontmatter.get("name")
        if isinstance(fm_name, str) and fm_name.strip():
            return fm_name.strip()
        return skill_name_from_uri(self.uri)

    @property
    def description(self) -> str:
        value = self.frontmatter.get("description")
        return value if isinstance(value, str) else ""

    @property
    def is_dynamic(self) -> bool:
        return self.resources == "dynamic"

    def digest_map(self) -> Dict[str, str]:
        """``{file_uri: digest}`` for approval binding. Empty for dynamic skills."""
        if self.is_dynamic:
            return {}
        return {entry.uri: entry.digest for entry in self.resources or []}

    def file_uris(self) -> List[str]:
        if self.is_dynamic:
            return []
        return [entry.uri for entry in self.resources or []]

    def find_file(self, file_uri: str) -> Optional[SkillFileEntry]:
        if self.is_dynamic:
            return None
        for entry in self.resources or []:
            if entry.uri == file_uri:
                return entry
        return None

    def total_bytes(self) -> int:
        if self.is_dynamic:
            return 0
        return sum(entry.size for entry in self.resources or [])

    def check_limits(self) -> List[str]:
        """Warn (not block) when the SHOULD-level spec limits are exceeded."""
        warnings: List[str] = []
        if not self.is_dynamic:
            count = len(self.resources or [])
            if count > MAX_SKILL_FILES:
                warnings.append(
                    f"skill {self.uri!r} has {count} files (>{MAX_SKILL_FILES})"
                )
            total = self.total_bytes()
            if total > MAX_SKILL_BYTES:
                warnings.append(
                    f"skill {self.uri!r} is {total} bytes (>{MAX_SKILL_BYTES})"
                )
        return warnings


def skill_name_from_uri(uri: str) -> str:
    """Recover the skill name from a SKILL.md URI (parent dir of the last segment)."""
    path = uri.split("://", 1)[-1] if "://" in uri else uri
    path = path.rstrip("/")
    if path.endswith("/SKILL.md"):
        path = path[: -len("/SKILL.md")]
    segments = [seg for seg in path.split("/") if seg]
    return segments[-1] if segments else ""


def compute_digest(content: bytes) -> str:
    """SHA-256 of raw bytes, formatted ``sha256:<hex>`` per the wire spec."""
    return _DIGEST_PREFIX + hashlib.sha256(content).hexdigest()


def verify_file(entry: SkillFileEntry, content: bytes) -> Optional[SkillIntegrityError]:
    """Verify one file's raw bytes against its manifest entry (digest + size)."""
    size = len(content)
    if entry.size != size:
        return SkillIntegrityError(
            entry.uri, f"size mismatch: manifest={entry.size} actual={size}"
        )
    actual = compute_digest(content)
    if actual != entry.digest:
        return SkillIntegrityError(
            entry.uri, f"digest mismatch: manifest={entry.digest} actual={actual}"
        )
    return None


def verify_frontmatter(
    manifest: SkillManifest, raw_frontmatter: Any
) -> Optional[SkillIntegrityError]:
    """Field-by-field comparison of manifest frontmatter vs freshly parsed frontmatter."""
    if not isinstance(raw_frontmatter, dict):
        return SkillIntegrityError(manifest.uri, "frontmatter is not a mapping")
    expected = manifest.frontmatter
    for key, value in expected.items():
        if key not in raw_frontmatter:
            return SkillIntegrityError(manifest.uri, f"frontmatter missing key {key!r}")
        if raw_frontmatter.get(key) != value:
            return SkillIntegrityError(
                manifest.uri,
                f"frontmatter value mismatch for {key!r}: "
                f"manifest={value!r} actual={raw_frontmatter.get(key)!r}",
            )
    return None


def parse_frontmatter_from_markdown(text: str) -> Dict[str, Any]:
    """Best-effort YAML frontmatter extraction (shared with registry helpers)."""
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover
        return {}
    stripped = text.lstrip("\ufeff").strip()
    if not stripped.startswith("---"):
        return {}
    lines = stripped.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    end_idx: Optional[int] = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}
    block = "\n".join(lines[1:end_idx])
    try:
        parsed = yaml.safe_load(block) or {}
    except Exception as exc:
        logger.warning("Failed to parse SKILL.md frontmatter: %s", exc)
        return {}
    return parsed if isinstance(parsed, dict) else {}
