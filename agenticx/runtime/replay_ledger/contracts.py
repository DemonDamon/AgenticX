#!/usr/bin/env python3
"""Stable contracts for durable runtime replay.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

SCHEMA_VERSION = 1
LEDGER_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
RUN_STATUSES = frozenset({"running", "completed", "failed", "cancelled", "interrupted"})
COMPLETENESS_VALUES = frozenset({"complete", "partial"})
EFFECT_CLASSES = frozenset({"none", "read", "local_write", "external_write", "unknown"})
EVENT_TYPES = frozenset(
    {
        "run_started",
        "run_resumed",
        "user_message",
        "round_started",
        "assistant_output_started",
        "assistant_output_completed",
        "tool_call",
        "tool_progress",
        "tool_result",
        "confirm_required",
        "confirm_response",
        "clarification_required",
        "clarification_response",
        "clarification_suspended",
        "subagent_started",
        "subagent_progress",
        "subagent_checkpoint",
        "subagent_completed",
        "subagent_error",
        "compaction",
        "context_stats",
        "stall",
        "error",
        "artifact",
        "run_completed",
        "ledger_gap",
    }
)


def validate_ledger_id(value: str, field_name: str) -> str:
    """Validate an identifier before it reaches a path or glob operation."""
    normalized = str(value or "").strip()
    if (
        normalized in {".", ".."}
        or not LEDGER_ID_PATTERN.fullmatch(normalized)
        or "/" in normalized
        or "\\" in normalized
    ):
        raise ValueError(f"invalid ledger id for {field_name}")
    return normalized


def _required_text(data: dict[str, Any], key: str) -> str:
    value = str(data.get(key, "") or "").strip()
    if not value:
        raise ValueError(f"{key} must not be empty")
    return value


@dataclass
class ReplayRunRecord:
    """Persisted metadata for one agent turn."""

    run_id: str
    session_id: str
    turn_id: str
    agent_id: str
    status: str
    created_at: float
    updated_at: float
    completed_at: float | None = None
    parent_run_id: str | None = None
    forked_from_event_id: str | None = None
    forked_from_seq: int | None = None
    provider: str | None = None
    model: str | None = None
    event_count: int = 0
    last_seq: int = 0
    completeness: str = "complete"
    gap_reason: str | None = None
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        """Serialize the record."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReplayRunRecord":
        """Deserialize and validate persisted metadata."""
        status = str(data.get("status", "running") or "running").strip()
        if status not in RUN_STATUSES:
            status = "interrupted"
        completeness = str(data.get("completeness", "complete") or "complete").strip()
        if completeness not in COMPLETENESS_VALUES:
            completeness = "partial"
        return cls(
            run_id=validate_ledger_id(_required_text(data, "run_id"), "run_id"),
            session_id=validate_ledger_id(
                _required_text(data, "session_id"), "session_id"
            ),
            turn_id=_required_text(data, "turn_id"),
            agent_id=str(data.get("agent_id", "meta") or "meta").strip(),
            status=status,
            created_at=float(data.get("created_at", 0.0) or 0.0),
            updated_at=float(data.get("updated_at", 0.0) or 0.0),
            completed_at=(
                float(data["completed_at"])
                if data.get("completed_at") is not None
                else None
            ),
            parent_run_id=str(data.get("parent_run_id", "") or "").strip() or None,
            forked_from_event_id=str(data.get("forked_from_event_id", "") or "").strip()
            or None,
            forked_from_seq=(
                int(data["forked_from_seq"])
                if data.get("forked_from_seq") is not None
                else None
            ),
            provider=str(data.get("provider", "") or "").strip() or None,
            model=str(data.get("model", "") or "").strip() or None,
            event_count=max(0, int(data.get("event_count", 0) or 0)),
            last_seq=max(0, int(data.get("last_seq", 0) or 0)),
            completeness=completeness,
            gap_reason=str(data.get("gap_reason", "") or "").strip() or None,
            schema_version=int(
                data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION
            ),
        )


@dataclass
class RunEvent:
    """One durable semantic event in a replay run."""

    event_id: str
    run_id: str
    session_id: str
    turn_id: str
    seq: int
    ts: float
    type: str
    agent_id: str
    round_idx: int | None = None
    tool_call_id: str | None = None
    parent_event_id: str | None = None
    title: str = ""
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    payload_ref: str | None = None
    checkpoint_ref: str | None = None
    workspace_ref: str | None = None
    effect_class: str = "none"
    branchable: bool = False
    unbranchable_reason: str | None = None
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        """Serialize the event."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RunEvent":
        """Deserialize and validate a persisted event."""
        seq = int(data.get("seq", 0) or 0)
        if seq < 1:
            raise ValueError("seq must be at least 1")
        effect_class = str(data.get("effect_class", "none") or "none").strip()
        if effect_class not in EFFECT_CLASSES:
            effect_class = "unknown"
        schema_version = int(
            data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION
        )
        branchable = bool(data.get("branchable", False))
        reason = str(data.get("unbranchable_reason", "") or "").strip() or None
        if schema_version != SCHEMA_VERSION:
            branchable = False
            reason = "unsupported_schema_version"
        payload = data.get("payload")
        return cls(
            event_id=_required_text(data, "event_id"),
            run_id=validate_ledger_id(_required_text(data, "run_id"), "run_id"),
            session_id=validate_ledger_id(
                _required_text(data, "session_id"), "session_id"
            ),
            turn_id=_required_text(data, "turn_id"),
            seq=seq,
            ts=float(data.get("ts", 0.0) or 0.0),
            type=_required_text(data, "type"),
            agent_id=str(data.get("agent_id", "meta") or "meta").strip(),
            round_idx=(
                int(data["round_idx"]) if data.get("round_idx") is not None else None
            ),
            tool_call_id=str(data.get("tool_call_id", "") or "").strip() or None,
            parent_event_id=str(data.get("parent_event_id", "") or "").strip() or None,
            title=str(data.get("title", "") or ""),
            summary=str(data.get("summary", "") or ""),
            payload=dict(payload) if isinstance(payload, dict) else {},
            payload_ref=str(data.get("payload_ref", "") or "").strip() or None,
            checkpoint_ref=str(data.get("checkpoint_ref", "") or "").strip() or None,
            workspace_ref=str(data.get("workspace_ref", "") or "").strip() or None,
            effect_class=effect_class,
            branchable=branchable,
            unbranchable_reason=reason,
            schema_version=schema_version,
        )
