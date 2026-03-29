#!/usr/bin/env python3
"""Instinct data model and markdown serialization.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

import yaml  # type: ignore[import-untyped]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Instinct:
    """Persistable behavioral instinct extracted from observations."""

    id: str
    trigger: str
    action: str
    confidence: float
    domain: str
    scope: Literal["project", "global"]
    project_id: str | None
    evidence: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def to_markdown(self) -> str:
        """Serialize instinct into YAML frontmatter plus markdown body."""
        frontmatter = {
            "id": self.id,
            "trigger": self.trigger,
            "action": self.action,
            "confidence": float(self.confidence),
            "domain": self.domain,
            "scope": self.scope,
            "project_id": self.project_id,
            "evidence": list(self.evidence),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        body = "\n".join(
            [
                "# Instinct",
                "",
                "## Trigger",
                self.trigger,
                "",
                "## Action",
                self.action,
            ]
        )
        return f"---\n{yaml.safe_dump(frontmatter, sort_keys=False)}---\n\n{body}\n"

    @classmethod
    def from_markdown(cls, content: str) -> "Instinct":
        """Deserialize instinct from markdown frontmatter."""
        stripped = content.strip()
        if not stripped.startswith("---"):
            raise ValueError("Missing instinct frontmatter")
        lines = content.splitlines()
        end_idx = None
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                end_idx = index
                break
        if end_idx is None:
            raise ValueError("Unclosed instinct frontmatter")
        parsed = yaml.safe_load("\n".join(lines[1:end_idx])) or {}
        if not isinstance(parsed, dict):
            raise ValueError("Invalid instinct frontmatter payload")
        return cls(
            id=str(parsed.get("id", "")).strip(),
            trigger=str(parsed.get("trigger", "")).strip(),
            action=str(parsed.get("action", "")).strip(),
            confidence=float(parsed.get("confidence", 0.5)),
            domain=str(parsed.get("domain", "workflow")).strip(),
            scope=str(parsed.get("scope", "project")).strip(),  # type: ignore[arg-type]
            project_id=str(parsed.get("project_id", "")).strip() or None,
            evidence=[str(item) for item in parsed.get("evidence", []) or []],
            created_at=str(parsed.get("created_at", _now_iso())),
            updated_at=str(parsed.get("updated_at", _now_iso())),
        )
