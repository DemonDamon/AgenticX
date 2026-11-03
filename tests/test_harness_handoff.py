#!/usr/bin/env python3
"""Tests for the SP4 context handoff engine.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import pytest

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import (
    TURN_STATUS_SUCCESS,
    HarnessCapabilities,
    TurnRequest,
    TurnResult,
)
from agenticx.harness.handoff import (
    HANDOFF_ACTIVE,
    HANDOFF_INVALIDATED,
    HANDOFF_SUPERSEDED,
    STRATEGY_DELTA,
    STRATEGY_FULL,
    STRATEGY_MANUAL,
    STRATEGY_RESUME,
    AppThreadSnapshot,
    ContextHandoff,
    HandoffEngine,
    HandoffError,
    HandoffPlanError,
    HandoffStore,
    HistoryMessage,
    RunRecord,
    TemplateSummarizer,
    ThreadBinding,
    decide_strategy,
    redact_text,
    redact_summary,
    summary_to_payload,
)
from agenticx.harness.handoff.security import (
    EgressViolationError,
    egress_view,
)
from agenticx.harness.handoff.summarizer import SummarizationResult
from agenticx.harness.handoff.types import HandoffSummary


# ----------------------------------------------------------------------
# fixtures
# ----------------------------------------------------------------------
class StubAdapter(HarnessAdapter):
    harness_id = "stub"
    display_name = "Stub"
    description = "stub adapter"

    def __init__(self, harness_id: str = "stub", resume: bool = True) -> None:
        self.harness_id = harness_id
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self.adopted: List[tuple] = []
        self.turns: List[Dict[str, Any]] = []
        self._counter = 0

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,
            pty=False,
            streaming=False,
            turn_snapshots=False,
            idempotency=False,
            resume=resume_flag(self),
        )

    def spawn(self, cwd: str, *, options: Optional[Dict[str, Any]] = None):
        self._counter += 1
        import uuid

        sid = str(uuid.uuid4())
        self._sessions[sid] = {
            "session_id": sid,
            "cwd": cwd,
            "state": "idle",
            "options": dict(options or {}),
            "native_thread_id": None,
        }
        return dict(self._sessions[sid])

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        session = self._sessions[session_id]
        session["state"] = "running"
        self.turns.append(
            {"session_id": session_id, "text": request.text}
        )
        session["state"] = "idle"
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_SUCCESS,
            result_text="stub ok",
            tail="",
            detail={"native_thread_id": session.get("native_thread_id")},
        )

    def stop(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def available(self) -> bool:
        return True

    def describe(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        return list(self._sessions.values())

    def adopt_thread(self, session_id: str, native_thread_id: str) -> None:
        session = self._sessions[session_id]
        session["native_thread_id"] = native_thread_id
        self.adopted.append((session_id, native_thread_id))


def resume_flag(adapter: "StubAdapter") -> bool:
    return getattr(adapter, "_resume_cap", True)


def _snapshot(
    app_thread_id: str = "thread-1",
    current: Optional[str] = "opencode",
    history_len: int = 10,
    threads: Optional[List[ThreadBinding]] = None,
    runs: Optional[List[RunRecord]] = None,
    memory: str = "user prefers tabs",
) -> AppThreadSnapshot:
    history = [
        HistoryMessage(
            role="user" if i % 2 == 0 else "assistant",
            content=f"message {i}",
            run_id=f"run-{i // 2}",
            harness=current or "unknown",
        )
        for i in range(history_len)
    ]
    history[0].content = "Build the payment reconciliation report"
    return AppThreadSnapshot(
        app_thread_id=app_thread_id,
        current_harness=current,
        cwd="/tmp",
        history=history,
        runs=runs or [],
        threads=threads or [],
        memory_snapshot=memory,
        knowledge_snapshot="finance domain glossary v3",
        todos="- [ ] verify totals",
    )


# ----------------------------------------------------------------------
# policy
# ----------------------------------------------------------------------
def test_policy_auto_resume_when_native_thread_exists():
    snap = _snapshot(
        threads=[
            ThreadBinding(
                harness="opencode",
                native_thread_id="ses_123",
                last_seen_position=8,
            )
        ]
    )
    plan = decide_strategy(snap, "opencode")
    assert plan.strategy == STRATEGY_RESUME
    assert plan.resume_native_thread_id == "ses_123"
    assert plan.delta_from_position == 8


def test_policy_auto_delta_small_window():
    snap = _snapshot(
        threads=[
            ThreadBinding(harness="codex", last_seen_position=6)
        ]
    )
    plan = decide_strategy(snap, "codex")
    assert plan.strategy == STRATEGY_DELTA
    assert plan.delta_from_position == 6


def test_policy_staleness_downgrades_to_full():
    snap = _snapshot(
        history_len=200,
        threads=[
            ThreadBinding(harness="codex", last_seen_position=2)
        ],
    )
    plan = decide_strategy(snap, "codex")
    assert plan.strategy == STRATEGY_FULL
    assert plan.notes  # downgrade is explained for the UI


def test_policy_full_when_never_seen():
    plan = decide_strategy(_snapshot(), "codex")
    assert plan.strategy == STRATEGY_FULL


def test_policy_manual_user_choice():
    plan = decide_strategy(_snapshot(), "codex", user_strategy="manual_context")
    assert plan.strategy == STRATEGY_MANUAL


def test_policy_explicit_resume_without_thread_fails_closed():
    with pytest.raises(HandoffPlanError):
        decide_strategy(_snapshot(), "codex", user_strategy="resume")


def test_policy_unknown_strategy_rejected():
    with pytest.raises(HandoffPlanError):
        decide_strategy(_snapshot(), "codex", user_strategy="yolo")


# ----------------------------------------------------------------------
# security
# ----------------------------------------------------------------------
def test_redact_text_scrubs_secrets():
    text = "key sk-abcdefghijklmnop1234 at 10.1.2.3 and Bearer abcdef1234567890abcdef"
    out = redact_text(text)
    assert "sk-abcdefghijklmnop1234" not in out
    assert "10.1.2.3" not in out
    assert "abcdef1234567890abcdef" not in out
    assert "[REDACTED:api-key]" in out
    assert "[REDACTED:intranet-ip]" in out


def test_redact_summary_copies_all_fields():
    summary = HandoffSummary(
        goal="use token sk-abcdefghijklmnop1234",
        memory_snapshot="secret Bearer abcdef1234567890abcdef",
    )
    redacted = redact_summary(summary)
    assert "sk-abcdefghijklmnop1234" not in redacted.goal
    assert "Bearer abcdef" not in redacted.memory_snapshot
    assert summary.goal == "use token sk-abcdefghijklmnop1234"  # original intact


def test_injection_wrapper_marks_non_executable():
    payload = summary_to_payload(
        HandoffSummary(goal="do the thing", memory_snapshot="mem")
    )
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in payload
    assert "NOT" in payload and "instruction" in payload
    assert "AGENTICX CONTEXT HANDOFF (END)" in payload
    assert "do the thing" in payload
    assert "## AgenticX memory snapshot (reference)" in payload


def test_egress_allowlist_blocks_violations():
    with pytest.raises(EgressViolationError):
        egress_view(HandoffSummary(goal="x"), {"goal", "made_up_field"})


def test_egress_view_default_excludes_snapshots():
    view = egress_view(
        HandoffSummary(goal="g", memory_snapshot="secret"), 
        {"goal"},
    )
    assert view == {"goal": "g"}


# ----------------------------------------------------------------------
# store
# ----------------------------------------------------------------------
def test_store_append_and_active(tmp_path):
    store = HandoffStore(str(tmp_path))
    h1 = ContextHandoff(
        handoff_id="ho_1",
        app_thread_id="t1",
        from_harness="a",
        to_harness="b",
        strategy=STRATEGY_FULL,
        source_end_position=10,
        created_at="2026-11-03T10:00:00Z",
    )
    store.append_handoff(h1)
    assert store.active_handoff("t1").handoff_id == "ho_1"

    h2 = ContextHandoff(
        handoff_id="ho_2",
        app_thread_id="t1",
        from_harness="b",
        to_harness="a",
        strategy=STRATEGY_RESUME,
        source_end_position=20,
        created_at="2026-11-03T11:00:00Z",
        supersedes="ho_1",
    )
    store.append_handoff(h2)
    assert store.active_handoff("t1").handoff_id == "ho_2"
    statuses = {row["handoff"]["handoff_id"]: row["status"] for row in store.handoff_statuses("t1")}
    assert statuses["ho_1"] == HANDOFF_SUPERSEDED
    assert statuses["ho_2"] == HANDOFF_ACTIVE


def test_store_rollback_invalidation(tmp_path):
    store = HandoffStore(str(tmp_path))
    store.append_handoff(
        ContextHandoff(
            handoff_id="ho_1",
            app_thread_id="t1",
            from_harness="a",
            to_harness="b",
            strategy=STRATEGY_FULL,
            source_end_position=15,
            created_at="2026-11-03T10:00:00Z",
        )
    )
    invalidated = store.invalidate_covering("t1", 10, "test rollback")
    assert invalidated == ["ho_1"]
    assert store.active_handoff("t1") is None
    statuses = {row["handoff"]["handoff_id"]: row["status"] for row in store.handoff_statuses("t1")}
    assert statuses["ho_1"] == HANDOFF_INVALIDATED


def test_store_ttl_expiry(tmp_path):
    store = HandoffStore(str(tmp_path), retention_days=1)
    store.append_handoff(
        ContextHandoff(
            handoff_id="ho_old",
            app_thread_id="t1",
            from_harness="a",
            to_harness="b",
            strategy=STRATEGY_FULL,
            source_end_position=5,
            created_at="2020-01-01T00:00:00Z",
        )
    )
    assert store.active_handoff("t1") is None


# ----------------------------------------------------------------------
# summarizer
# ----------------------------------------------------------------------
def test_template_summarizer_eight_sections():
    snap = _snapshot(
        runs=[
            RunRecord(
                run_id="run-1",
                harness="opencode",
                end_position=10,
                changed_files=["a.py", "b.py"],
                commands=["pytest -q"],
                tests=["test_a"],
                status="completed",
            ),
            RunRecord(
                run_id="run-2",
                harness="opencode",
                end_position=10,
                status="failed",
            ),
        ]
    )
    result = TemplateSummarizer().summarize(snap, decide_strategy(snap, "codex"))
    s = result.summary
    assert "payment reconciliation" in s.goal
    assert "a.py" in s.changed_files and "b.py" in s.changed_files
    assert "pytest -q" in s.commands_and_tests
    assert "run-2 failed" in s.known_failures
    assert s.memory_snapshot == "user prefers tabs"
    assert s.knowledge_snapshot == "finance domain glossary v3"
    assert result.provider_id == "template-local-v1"


def test_template_summarizer_manual_context():
    snap = _snapshot()
    plan = decide_strategy(snap, "codex", user_strategy=STRATEGY_MANUAL)
    result = TemplateSummarizer().summarize(
        snap, plan, manual_context="Focus on the report export step."
    )
    assert "report export" in result.summary.goal


# ----------------------------------------------------------------------
# engine
# ----------------------------------------------------------------------
def _registry(*adapters: StubAdapter) -> HarnessRegistry:
    registry = HarnessRegistry()
    for adapter in adapters:
        registry.register(adapter)
    return registry


def test_engine_full_handoff_injects_wrapped_payload(tmp_path):
    target = StubAdapter("codex")
    engine = HandoffEngine(_registry(target), HandoffStore(str(tmp_path)))
    snap = _snapshot()
    result = engine.execute_handoff(
        snap, "codex", pending_user_message="continue from here"
    )
    assert result.ok
    assert result.plan.strategy == STRATEGY_FULL
    # the injected turn carries the wrapper + the pending message
    text = target.turns[0]["text"]
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in text
    assert "payment reconciliation" in text
    assert text.endswith("continue from here")
    # persisted append-only with audit fields
    stored = HandoffStore(str(tmp_path)).active_handoff("thread-1")
    assert stored.handoff_id == result.handoff.handoff_id
    assert stored.from_harness == "opencode"
    assert stored.created_by_provider == "template-local-v1"
    assert stored.source_end_position == 10


def test_engine_resume_tier_adopts_thread(tmp_path):
    target = StubAdapter("opencode")
    engine = HandoffEngine(_registry(target), HandoffStore(str(tmp_path)))
    snap = _snapshot(
        current="codex",
        threads=[
            ThreadBinding(
                harness="opencode",
                native_thread_id="ses_abc",
                last_seen_position=8,
            )
        ],
    )
    result = engine.execute_handoff(snap, "opencode")
    assert result.plan.strategy == STRATEGY_RESUME
    assert target.adopted and target.adopted[0][1] == "ses_abc"
    assert result.handoff.resumed_native_thread_id == "ses_abc"


def test_engine_supersedes_previous_handoff(tmp_path):
    target = StubAdapter("codex")
    engine = HandoffEngine(_registry(target), HandoffStore(str(tmp_path)))
    snap = _snapshot()
    first = engine.execute_handoff(snap, "codex")
    second = engine.execute_handoff(snap, "codex")
    assert second.handoff.supersedes == first.handoff.handoff_id


def test_engine_manual_requires_context(tmp_path):
    target = StubAdapter("codex")
    engine = HandoffEngine(_registry(target), HandoffStore(str(tmp_path)))
    with pytest.raises(HandoffError, match="manual context"):
        engine.execute_handoff(
            _snapshot(), "codex", user_strategy=STRATEGY_MANUAL
        )


def test_engine_redacts_before_persist(tmp_path):
    target = StubAdapter("codex")

    class LeakySummarizer(TemplateSummarizer):
        def summarize(self, snapshot, plan, manual_context=None):
            result = super().summarize(snapshot, plan, manual_context)
            result.summary.goal += " token sk-abcdefghijklmnop1234"
            return result

    engine = HandoffEngine(
        _registry(target), HandoffStore(str(tmp_path)),
        summarizer=LeakySummarizer(),
    )
    result = engine.execute_handoff(_snapshot(), "codex")
    assert "sk-abcdefghijklmnop1234" not in result.injected_payload
    stored = HandoffStore(str(tmp_path)).active_handoff("thread-1")
    assert "sk-abcdefghijklmnop1234" not in stored.injected_payload
    assert "sk-abcdefghijklmnop1234" not in stored.summary.goal


def test_engine_unavailable_target_fails_closed(tmp_path):
    class UnavailableAdapter(StubAdapter):
        def available(self) -> bool:
            return False

    engine = HandoffEngine(
        _registry(UnavailableAdapter("codex")), HandoffStore(str(tmp_path))
    )
    with pytest.raises(HandoffError, match="not available"):
        engine.execute_handoff(_snapshot(), "codex")


def test_engine_rollback_invalidation_linkage(tmp_path):
    target = StubAdapter("codex")
    engine = HandoffEngine(_registry(target), HandoffStore(str(tmp_path)))
    engine.execute_handoff(_snapshot(), "codex")
    invalidated = engine.invalidate_for_rollback("thread-1", 5, "user rollback")
    assert len(invalidated) == 1
    assert engine.audit_view("thread-1")[0]["status"] == HANDOFF_INVALIDATED
