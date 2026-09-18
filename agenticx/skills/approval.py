#!/usr/bin/env python3
"""Skill approvals bound to manifest digest sets (Skills over MCP, host side).

"审批即指纹" (MASTER-PLAN principle 4): an approval record is
``{server_id, skill_uri, {file_uri: digest}}`` — adding, removing, or
modifying any file invalidates the approval, forcing a fresh user consent.

The activation gate :func:`check_activation` composes three checks:

1. **Content safety** — ``scan_skill_deep`` + ``should_allow`` (guard.py
   trust levels; digest checks are consistency, not a security boundary).
2. **Consent** — when ``learning.agent_writes_require_approval`` is on, a
   stored approval whose digest set matches the current manifest exactly
   must exist, otherwise the skill is refused.
3. **Nested skills** — a SKILL.md referencing another skill's URI is a read,
   not an activation; the referenced skill needs its own fresh consent.
   The decision surfaces those URIs so callers can gate them explicitly.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from agenticx.skills.manifest import SkillManifest

logger = logging.getLogger(__name__)

DEFAULT_APPROVALS_PATH = Path.home() / ".agenticx" / "skills" / "approvals.json"

_SKILL_URI_RE = re.compile(r"skill://[A-Za-z0-9._\-]+(?:/[A-Za-z0-9._\-]+)*")
_TRAILING_PUNCT = ".,;:!?)\"'`]>}"
_KEY_SEPARATOR = "::"


def approval_key(server_id: str, skill_uri: str) -> str:
    """Primary key of an approval record: server identity + skill URI."""
    return f"{server_id}{_KEY_SEPARATOR}{skill_uri}"


class SkillApproval(BaseModel):
    """One user consent, bound to the exact digest set of a skill manifest."""

    server_id: str
    skill_uri: str
    file_digests: Dict[str, str] = Field(default_factory=dict)
    granted_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    origin: str = "mcp"
    model_config = ConfigDict(extra="allow")

    @property
    def key(self) -> str:
        return approval_key(self.server_id, self.skill_uri)

    @classmethod
    def for_manifest(
        cls, server_id: str, manifest: SkillManifest, *, origin: str = "mcp"
    ) -> "SkillApproval":
        """Bind a fresh approval to the manifest's current digest set."""
        if manifest.is_dynamic:
            raise ValueError(
                "dynamic skills cannot be bound to a digest set; "
                "their content changes per request and cannot be approved"
            )
        return cls(
            server_id=server_id,
            skill_uri=manifest.uri,
            file_digests=manifest.digest_map(),
            origin=origin,
        )

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump(mode="json")

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillApproval":
        return cls.model_validate(data)


def is_valid(approval: SkillApproval, manifest: SkillManifest) -> tuple[bool, str]:
    """
    The approval is valid only when the URI set and every digest match the
    manifest exactly; any added / removed / modified file invalidates it.
    """
    if approval.server_id is None or approval.skill_uri != manifest.uri:
        return False, f"approval is for a different skill ({approval.skill_uri!r})"
    if manifest.is_dynamic:
        return False, "dynamic skill content cannot be bound to a digest set"
    expected = manifest.digest_map()
    actual = approval.file_digests
    if set(expected) != set(actual):
        missing = sorted(set(expected) - set(actual))
        added = sorted(set(actual) - set(expected))
        return False, f"file set changed (missing={missing}, added={added})"
    for uri, digest in expected.items():
        if actual.get(uri) != digest:
            return False, f"digest changed for {uri}"
    return True, "ok"


class ApprovalStore:
    """Persistent approval records at ``~/.agenticx/skills/approvals.json``."""

    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = Path(path) if path is not None else DEFAULT_APPROVALS_PATH

    # ------------------------------------------------------------- persistence

    def _load_raw(self) -> Dict[str, Dict[str, Any]]:
        if not self.path.is_file():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("Failed to read skill approvals from %s", self.path)
            return {}
        return data if isinstance(data, dict) else {}

    def _save_raw(self, raw: Dict[str, Dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", dir=str(self.path.parent), delete=False, prefix=".approvals-",
            suffix=".tmp", encoding="utf-8",
        ) as handle:
            json.dump(raw, handle, indent=2, sort_keys=True)
            handle.write("\n")
            tmp = Path(handle.name)
        os.replace(tmp, self.path)

    # -------------------------------------------------------------------- api

    def grant(
        self,
        server_id: str,
        manifest: SkillManifest,
        *,
        origin: str = "mcp",
    ) -> SkillApproval:
        """Record consent for the manifest's current digest set (write-through)."""
        approval = SkillApproval.for_manifest(server_id, manifest, origin=origin)
        raw = self._load_raw()
        raw[approval.key] = approval.to_dict()
        self._save_raw(raw)
        return approval

    def get(self, server_id: str, skill_uri: str) -> Optional[SkillApproval]:
        record = self._load_raw().get(approval_key(server_id, skill_uri))
        if not record:
            return None
        try:
            return SkillApproval.from_dict(record)
        except Exception:
            logger.warning("Invalid approval record for %s", skill_uri, exc_info=True)
            return None

    def revoke(self, server_id: str, skill_uri: str) -> bool:
        key = approval_key(server_id, skill_uri)
        raw = self._load_raw()
        if key not in raw:
            return False
        del raw[key]
        self._save_raw(raw)
        return True

    def list_all(self) -> List[SkillApproval]:
        approvals: List[SkillApproval] = []
        for record in self._load_raw().values():
            try:
                approvals.append(SkillApproval.from_dict(record))
            except Exception:
                continue
        return approvals

    def find_valid(
        self, server_id: str, manifest: SkillManifest
    ) -> Optional[SkillApproval]:
        """Return the stored approval only if it still matches the manifest."""
        approval = self.get(server_id, manifest.uri)
        if approval is None:
            return None
        valid, _ = is_valid(approval, manifest)
        return approval if valid else None

    def revoke_if_invalid(self, server_id: str, manifest: SkillManifest) -> bool:
        """Auto-revoke a stored approval that no longer matches the manifest."""
        approval = self.get(server_id, manifest.uri)
        if approval is None:
            return False
        valid, reason = is_valid(approval, manifest)
        if valid:
            return False
        self.revoke(server_id, manifest.uri)
        logger.info(
            "Revoked stale approval for %s (%s)", manifest.uri, reason
        )
        return True


# --------------------------------------------------------------- nested skills


def find_nested_skill_references(skill_md_uri: str, text: str) -> List[str]:
    """
    Extract ``skill://`` URIs referenced from SKILL.md that belong to *other*
    skills. Files under the skill's own root are references within the same
    skill; anything else is a nested-skill read that needs fresh consent.
    """
    root = skill_md_uri
    if root.endswith("/SKILL.md"):
        root = root[: -len("/SKILL.md")]
    found = set()
    for match in _SKILL_URI_RE.finditer(text):
        uri = match.group(0).rstrip(_TRAILING_PUNCT)
        if not uri or uri == skill_md_uri or uri.startswith(root + "/"):
            continue
        found.add(uri)
    return sorted(found)


# ------------------------------------------------------------- activation gate


class ActivationDecision:
    """Outcome of the activation gate: scan verdict + approval validity."""

    def __init__(
        self,
        *,
        allowed: bool,
        reasons: List[str],
        scan_result: Optional[Any] = None,
        approval: Optional[SkillApproval] = None,
        nested_skill_uris: Optional[List[str]] = None,
    ) -> None:
        self.allowed = allowed
        self.reasons = reasons
        self.scan_result = scan_result
        self.approval = approval
        self.nested_skill_uris = nested_skill_uris or []

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"ActivationDecision(allowed={self.allowed}, reasons={self.reasons!r})"
        )


def _agent_writes_require_approval() -> bool:
    try:
        from agenticx.learning.config import get as get_learning_config

        return bool(get_learning_config("agent_writes_require_approval", True))
    except Exception:
        return True


def check_activation(
    manifest: SkillManifest,
    *,
    skill_dir: Path,
    approval: Optional[SkillApproval] = None,
    require_approval: Optional[bool] = None,
    source: str = "community",
    scan_fn: Optional[Callable[..., Any]] = None,
) -> ActivationDecision:
    """
    Decide whether a (verified, cached) remote skill may be activated.

    Layers: content safety (guard trust levels) AND, when
    ``learning.agent_writes_require_approval`` is on, a digest-bound approval.
    Nested skill references are surfaced (reads, not activations).
    """
    from agenticx.skills.guard import should_allow

    reasons: List[str] = []
    if require_approval is None:
        require_approval = _agent_writes_require_approval()

    # 1. Content safety gate (digest checks above are not a security boundary).
    scan_result = None
    if skill_dir is not None and Path(skill_dir).is_dir():
        scanner = scan_fn
        if scanner is None:
            from agenticx.skills.guard import scan_skill_deep

            scanner = scan_skill_deep
        scan_result = scanner(skill_dir, source=source)
        content_ok, scan_reason = should_allow(scan_result, source)
        reasons.append(f"content-scan: {scan_reason}")
    else:
        content_ok = True
        reasons.append("content-scan: skipped (no skill directory provided)")

    # 2. Consent gate — approval bound to the exact digest set.
    approval_ok = True
    if require_approval:
        if approval is None:
            approval_ok = False
            reasons.append("approval: no approval record for this skill")
        else:
            valid, why = is_valid(approval, manifest)
            approval_ok = valid
            reasons.append(f"approval: {why}")

    # 3. Nested skills — referenced URIs are NOT activated by this approval.
    nested: List[str] = []
    skill_md = Path(skill_dir) / "SKILL.md"
    if skill_md.is_file():
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
            nested = find_nested_skill_references(manifest.uri, text)
        except OSError:
            nested = []
    if nested:
        reasons.append(
            "nested: referenced skill URIs are reads, not activations; each "
            f"needs its own consent: {nested}"
        )

    allowed = content_ok and approval_ok
    return ActivationDecision(
        allowed=allowed,
        reasons=reasons,
        scan_result=scan_result,
        approval=approval,
        nested_skill_uris=nested,
    )
