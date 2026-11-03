#!/usr/bin/env python3
"""Context handoff engine types (SP4).

Data model per master-plan section 5 (t3code ProviderSwitch/Handoff
localized): the AppThread (StudioSession) is the canonical history; a
ContextHandoff is an explicit, auditable, append-only graph record that
carries context from one harness to another. Records are never silently
rewritten -- regeneration supersedes, rollbacks invalidate (both are new
records).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Strategy ladder (four tiers, master plan section 5 + SP4 row).
STRATEGY_RESUME = "resume"
STRATEGY_DELTA = "delta"
STRATEGY_FULL = "full_summary"
STRATEGY_MANUAL = "manual_context"

STRATEGIES = frozenset(
    {STRATEGY_RESUME, STRATEGY_DELTA, STRATEGY_FULL, STRATEGY_MANUAL}
)

# Handoff record lifecycle (derived, never rewritten in place).
HANDOFF_ACTIVE = "active"
HANDOFF_SUPERSEDED = "superseded"
HANDOFF_INVALIDATED = "invalidated"
HANDOFF_EXPIRED = "expired"


@dataclass
class RunRecord:
    """One completed turn/run in the canonical history, as seen by the
    handoff engine. The caller (studio wiring, SP5b) assembles these from
    the real session records."""

    run_id: str = ""
    harness: str = ""
    # 1-based position of the last history message this run covers.
    end_position: int = 0
    changed_files: List[str] = field(default_factory=list)
    commands: List[str] = field(default_factory=list)
    tests: List[str] = field(default_factory=list)
    status: str = "completed"  # completed | failed | cancelled


@dataclass
class ThreadBinding:
    """A harness the AppThread has previously been bound to."""

    harness: str = ""
    native_thread_id: Optional[str] = None
    # Position in the canonical history where this harness last saw the
    # thread (0 = never; used for delta/staleness math).
    last_seen_position: int = 0
    last_active_run_id: str = ""


@dataclass
class HistoryMessage:
    role: str  # "user" | "assistant" | "tool"
    content: str = ""
    run_id: str = ""
    harness: str = ""


@dataclass
class AppThreadSnapshot:
    """Narrow input the engine needs from the AppThread (StudioSession).

    Keeping this a plain snapshot keeps the engine testable and decouples
    it from studio internals; SP5b wires the real assembler.
    """

    app_thread_id: str
    current_harness: Optional[str] = None
    cwd: str = ""
    history: List[HistoryMessage] = field(default_factory=list)
    runs: List[RunRecord] = field(default_factory=list)
    threads: List[ThreadBinding] = field(default_factory=list)
    # V2 mandatory injection points (master plan: memory / knowledge
    # snapshots are always part of the injected payload).
    memory_snapshot: str = ""
    knowledge_snapshot: str = ""
    todos: str = ""


@dataclass
class HandoffSummary:
    """The fixed eight-section summary (no adapter free-styling) plus the
    two V2 injection points."""

    goal: str = ""
    decisions: str = ""
    changed_files: str = ""
    commands_and_tests: str = ""
    plan_and_todos: str = ""
    open_approvals: str = ""
    checkpoint_diff: str = ""
    known_failures: str = ""
    memory_snapshot: str = ""
    knowledge_snapshot: str = ""

    def as_dict(self) -> Dict[str, str]:
        return {
            "goal": self.goal,
            "decisions": self.decisions,
            "changed_files": self.changed_files,
            "commands_and_tests": self.commands_and_tests,
            "plan_and_todos": self.plan_and_todos,
            "open_approvals": self.open_approvals,
            "checkpoint_diff": self.checkpoint_diff,
            "known_failures": self.known_failures,
            "memory_snapshot": self.memory_snapshot,
            "knowledge_snapshot": self.knowledge_snapshot,
        }


@dataclass
class ContextHandoff:
    """One explicit handoff record (append-only graph data)."""

    handoff_id: str
    app_thread_id: str
    from_harness: str
    to_harness: str
    strategy: str
    summary: HandoffSummary = field(default_factory=HandoffSummary)
    # Redacted, wrapped payload actually injected into the target harness.
    injected_payload: str = ""
    # Canonical-history coverage of the source context (rollback joins on
    # source_end_position).
    source_end_position: int = 0
    source_run_ids: List[str] = field(default_factory=list)
    # Target thread the handoff established / resumed.
    target_session_id: str = ""
    target_native_thread_id: Optional[str] = None
    resumed_native_thread_id: Optional[str] = None
    # Source harness's own native thread at handoff time. Recorded so a
    # later switch back (A→B→A) can resume A's thread instead of guessing.
    source_native_thread_id: Optional[str] = None
    # Audit fields.
    created_at: str = ""
    created_by_provider: str = ""
    supersedes: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        out = dict(self.__dict__)
        out["summary"] = self.summary.as_dict()
        return out

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "ContextHandoff":
        summary_raw = raw.get("summary") or {}
        return cls(
            handoff_id=str(raw.get("handoff_id") or ""),
            app_thread_id=str(raw.get("app_thread_id") or ""),
            from_harness=str(raw.get("from_harness") or ""),
            to_harness=str(raw.get("to_harness") or ""),
            strategy=str(raw.get("strategy") or ""),
            summary=HandoffSummary(**{
                k: str(summary_raw.get(k) or "")
                for k in HandoffSummary().as_dict()
            }),
            injected_payload=str(raw.get("injected_payload") or ""),
            source_end_position=int(raw.get("source_end_position") or 0),
            source_run_ids=list(raw.get("source_run_ids") or []),
            target_session_id=str(raw.get("target_session_id") or ""),
            target_native_thread_id=raw.get("target_native_thread_id"),
            resumed_native_thread_id=raw.get("resumed_native_thread_id"),
            source_native_thread_id=raw.get("source_native_thread_id"),
            created_at=str(raw.get("created_at") or ""),
            created_by_provider=str(raw.get("created_by_provider") or ""),
            supersedes=raw.get("supersedes"),
            detail=dict(raw.get("detail") or {}),
        )


@dataclass
class SwitchPlan:
    """Strategy decision produced by the policy layer."""

    strategy: str
    target_harness: str
    # Resume tier: the native thread to adopt, else None.
    resume_native_thread_id: Optional[str] = None
    # Delta window (positions) the summary should cover.
    delta_from_position: int = 0
    delta_to_position: int = 0
    # Why this strategy was chosen (audit / UI).
    reason: str = ""
    # Non-fatal notes (e.g. staleness downgrade).
    notes: List[str] = field(default_factory=list)


class HandoffPlanError(Exception):
    """Strategy selection cannot produce a valid plan."""
