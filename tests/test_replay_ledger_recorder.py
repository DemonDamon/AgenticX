#!/usr/bin/env python3
"""Tests for runtime event replay recording.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore, ReplayRunRecord
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: dict | None = None) -> bool:
        return True


class _Response:
    content = "final answer"
    tool_calls: list = []
    finish_reason = "stop"
    reasoning_content = ""


class _TextLLM:
    def invoke(self, *_args, **_kwargs):
        return _Response()

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


def _recorder(tmp_path: Path) -> tuple[ReplayLedgerStore, ReplayLedgerRecorder]:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
    )
    return store, recorder


def test_two_tool_rounds_record_expected_semantic_sequence(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    session = StudioSession()
    run_id = recorder.start_turn(turn_id="turn-r", user_input="do work")
    events = [
        RuntimeEvent("round_start", {"round": 1}),
        RuntimeEvent(
            "tool_call",
            {"name": "file_read", "arguments": {"path": "a"}, "tool_call_id": "c1"},
        ),
        RuntimeEvent(
            "tool_result", {"name": "file_read", "result": "a", "tool_call_id": "c1"}
        ),
        RuntimeEvent("round_start", {"round": 2}),
        RuntimeEvent(
            "tool_call",
            {"name": "file_edit", "arguments": {"path": "a"}, "tool_call_id": "c2"},
        ),
        RuntimeEvent(
            "tool_result", {"name": "file_edit", "result": "ok", "tool_call_id": "c2"}
        ),
        RuntimeEvent("round_start", {"round": 3}),
        RuntimeEvent("token", {"text": "final"}),
        RuntimeEvent(
            "final",
            {
                "text": "final",
                "reasoning": "because",
                "usage_metadata": {"total_tokens": 3},
            },
        ),
    ]
    for event in events:
        recorder.observe(event, session=session)
    rows, _ = store.read_events(run_id, limit=100)
    assert [row.type for row in rows] == [
        "run_started",
        "user_message",
        "round_started",
        "tool_call",
        "tool_result",
        "round_started",
        "tool_call",
        "tool_result",
        "round_started",
        "assistant_output_started",
        "assistant_output_completed",
        "run_completed",
    ]


def test_one_thousand_tokens_create_only_start_and_completed(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    session = StudioSession()
    run_id = recorder.start_turn(turn_id="turn-r", user_input="stream")
    for _ in range(1000):
        recorder.observe(RuntimeEvent("token", {"text": "x"}), session=session)
    recorder.observe(RuntimeEvent("final", {"text": "x" * 1000}), session=session)
    rows, _ = store.read_events(run_id)
    assert [row.type for row in rows].count("assistant_output_started") == 1
    assert [row.type for row in rows].count("assistant_output_completed") == 1


def test_tool_result_parent_points_to_tool_call_and_blobs_roundtrip(
    tmp_path: Path,
) -> None:
    store, recorder = _recorder(tmp_path)
    session = StudioSession()
    run_id = recorder.start_turn(turn_id="turn-r", user_input="tool")
    arguments = {"path": "full.txt", "content": "complete"}
    result = {"content": "full-result", "structured": {"ok": True}}
    recorder.observe(
        RuntimeEvent(
            "tool_call",
            {"name": "file_write", "arguments": arguments, "tool_call_id": "call-1"},
        ),
        session=session,
    )
    recorder.observe(
        RuntimeEvent(
            "tool_result",
            {"name": "file_write", "result": result, "tool_call_id": "call-1"},
        ),
        session=session,
    )
    rows, _ = store.read_events(run_id)
    call, tool_result = rows[-2:]
    assert tool_result.parent_event_id == call.event_id
    assert store.read_blob(run_id, call.payload_ref)["arguments"] == arguments
    assert store.read_blob(run_id, tool_result.payload_ref)["result"] == result


def test_tool_result_ledger_prefers_full_private_result_and_explicit_error(
    tmp_path: Path,
) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-r", user_input="tool")
    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_CALL.value,
            {"name": "file_read", "arguments": {}, "tool_call_id": "call-private"},
        ),
        session=StudioSession(),
    )
    full_result = "x" * 5001

    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_RESULT.value,
            {
                "name": "file_read",
                "result": "x" * 500 + "...[compacted]",
                "tool_call_id": "call-private",
            },
            private_data={"raw_result": full_result, "tool_status": "error"},
        ),
        session=StudioSession(),
    )

    result_event = store.read_events(run_id)[0][-1]
    assert result_event.payload["status"] == "error"
    assert store.read_blob(run_id, result_event.payload_ref)["result"] == full_result


@pytest.mark.parametrize(
    ("result", "expected_status"),
    [
        ('{"ok":false,"error":"denied"}', "error"),
        ("ERROR: tool failed", "error"),
        ("CANCELLED: user stopped", "cancelled"),
        ("[ACTION_REJECTED] user declined", "cancelled"),
    ],
)
def test_tool_result_fallback_uses_existing_status_classification(
    tmp_path: Path,
    result: str,
    expected_status: str,
) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-status", user_input="tool")
    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_CALL.value,
            {"name": "list_files", "arguments": {}, "tool_call_id": "call-status"},
        ),
        session=StudioSession(),
    )
    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_RESULT.value,
            {"name": "list_files", "result": result, "tool_call_id": "call-status"},
        ),
        session=StudioSession(),
    )

    result_event = store.read_events(run_id)[0][-1]
    assert result_event.payload["status"] == expected_status


@pytest.mark.parametrize("fail_on_append", [1, 2])
def test_start_turn_marks_opened_run_partial_when_initial_event_fails(
    tmp_path: Path,
    fail_on_append: int,
) -> None:
    class _FailingStore(ReplayLedgerStore):
        append_count = 0

        def append_event(self, run_id, event):
            self.append_count += 1
            if self.append_count == fail_on_append:
                raise OSError("disk full")
            return super().append_event(run_id, event)

    store = _FailingStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
    )

    with pytest.raises(OSError, match="disk full"):
        recorder.start_turn(turn_id="turn-r", user_input="hello")

    records = store.list_runs("session-r")
    assert len(records) == 1
    assert records[0].completeness == "partial"
    assert records[0].gap_reason == "recorder_start_failed"


def test_resume_start_failure_marks_existing_run_partial(tmp_path: Path) -> None:
    class _FailingResumeStore(ReplayLedgerStore):
        def append_event(self, run_id, event):
            raise OSError("resume append failed")

    store = _FailingResumeStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="existing-run",
            session_id="session-r",
            turn_id="turn-r",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
        resume_run_id="existing-run",
    )

    with pytest.raises(OSError, match="resume append failed"):
        recorder.start_turn(turn_id="turn-r", user_input="resume")

    record = store.get_run("existing-run")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "recorder_start_failed"


@pytest.mark.parametrize(
    ("existing_session", "existing_agent", "recorder_session", "recorder_agent"),
    [
        ("other-session", "meta", "session-r", "meta"),
        ("session-r", "avatar-a", "session-r", "avatar-b"),
    ],
)
def test_resume_rejects_checkpoint_owned_by_other_session_or_agent(
    tmp_path: Path,
    existing_session: str,
    existing_agent: str,
    recorder_session: str,
    recorder_agent: str,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="foreign-run",
            session_id=existing_session,
            turn_id="foreign-turn",
            agent_id=existing_agent,
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id=recorder_session,
        agent_id=recorder_agent,
        provider="test",
        model="test-model",
        resume_run_id="foreign-run",
    )

    with pytest.raises(ValueError, match="resume run ownership mismatch"):
        recorder.start_turn(turn_id="current-turn", user_input="resume")

    events, _ = store.read_events("foreign-run")
    assert events == []
    assert recorder.current_run_id is None
    assert recorder._disabled is True


def test_resume_reuses_matching_checkpoint_turn_id(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="crash-run",
            session_id="session-r",
            turn_id="crash-turn",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
        resume_run_id="crash-run",
    )

    assert recorder.start_turn(turn_id="crash-turn", user_input="resume") == "crash-run"
    assert recorder.turn_id == "crash-turn"
    assert store.read_events("crash-run")[0][0].type == "run_resumed"


def test_resume_rejects_stale_checkpoint_turn_without_appending(
    tmp_path: Path,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="stale-run",
            session_id="session-r",
            turn_id="old-turn",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
        resume_run_id="stale-run",
    )

    with pytest.raises(ValueError, match="resume turn mismatch"):
        recorder.start_turn(turn_id="new-turn", user_input="resume")

    assert store.read_events("stale-run")[0] == []
    record = store.get_run("stale-run")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "resume_turn_mismatch"
    assert recorder._disabled is True


def test_subagent_runtime_events_do_not_consume_parent_ledger_sequence(
    tmp_path: Path,
) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-r", user_input="delegate")

    recorder.observe(
        RuntimeEvent(EventType.SUBAGENT_STARTED.value, {"run_id": "child"}),
        session=StudioSession(),
    )

    rows, _ = store.read_events(run_id)
    assert [row.type for row in rows] == ["run_started", "user_message"]


def test_active_avatar_is_authoritative_replay_actor(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="avatar-worker",
        provider="test",
        model="test-model",
    )
    run_id = recorder.start_turn(turn_id="turn-r", user_input="hello")

    recorder.observe(
        RuntimeEvent(EventType.ROUND_START.value, {"round": 1}, agent_id="meta"),
        session=StudioSession(),
    )

    rows, _ = store.read_events(run_id)
    assert {row.agent_id for row in rows} == {"avatar-worker"}


@pytest.mark.parametrize(
    ("payload", "expected_name", "expected_result", "expected_status"),
    [
        (
            {
                "tool_call_id": "call-1",
                "tool_name": "file_read",
                "content": "content value",
                "tool_status": "completed",
            },
            "file_read",
            "content value",
            "completed",
        ),
        (
            {
                "tool_call_id": "call-1",
                "name": "file_read",
                "text": "ERROR: denied",
            },
            "file_read",
            "ERROR: denied",
            "error",
        ),
        (
            {
                "tool_call_id": "call-1",
                "name": "file_read",
                "result": {"ok": False},
                "is_error": True,
            },
            "file_read",
            {"ok": False},
            "error",
        ),
    ],
)
def test_tool_result_normalizes_supported_payload_shapes(
    tmp_path: Path,
    payload: dict,
    expected_name: str,
    expected_result,
    expected_status: str,
) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-r", user_input="tool")
    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_CALL.value,
            {"name": "file_read", "arguments": {}, "tool_call_id": "call-1"},
        ),
        session=StudioSession(),
    )

    recorder.observe(
        RuntimeEvent(EventType.TOOL_RESULT.value, payload), session=StudioSession()
    )

    result_event = store.read_events(run_id)[0][-1]
    blob = store.read_blob(run_id, result_event.payload_ref)
    assert result_event.title == expected_name
    assert result_event.payload["status"] == expected_status
    assert blob["result"] == expected_result


def test_orphan_tool_result_marks_run_partial_and_unbranchable(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-r", user_input="tool")

    recorder.observe(
        RuntimeEvent(
            EventType.TOOL_RESULT.value,
            {"tool_call_id": "missing", "name": "file_read", "result": "value"},
        ),
        session=StudioSession(),
    )

    rows, _ = store.read_events(run_id)
    result_event = next(row for row in rows if row.type == "tool_result")
    record = store.get_run(run_id)
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "orphan_tool_result"
    assert result_event.parent_event_id is None
    assert result_event.branchable is False
    assert result_event.unbranchable_reason == "orphan_tool_result"
    assert rows[-1].type == "ledger_gap"


def test_checkpoint_failure_marks_gap_and_blocks_later_stable_boundaries(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-gap", user_input="work")
    session = StudioSession()
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.capture_git_workspace_snapshot",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("snapshot failed")),
    )

    recorder._append("assistant_output_completed", session=session)
    recorder._append("assistant_output_completed", session=session)

    rows, _ = store.read_events(run_id)
    assert [row.type for row in rows[-3:]] == [
        "assistant_output_completed",
        "ledger_gap",
        "assistant_output_completed",
    ]
    assert rows[-3].unbranchable_reason == "context_checkpoint_failed"
    assert rows[-1].branchable is False
    assert rows[-1].checkpoint_ref is None
    assert rows[-1].unbranchable_reason == "ledger_gap"
    record = store.get_run(run_id)
    assert record is not None
    assert record.completeness == "partial"


def test_resume_partial_run_inherits_after_gap(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="partial-run",
            session_id="session-r",
            turn_id="turn-r",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
            completeness="partial",
            gap_reason="previous_append_failed",
        )
    )
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-r",
        agent_id="meta",
        provider="test",
        model="test-model",
        resume_run_id="partial-run",
    )

    recorder.start_turn(turn_id="turn-r", user_input="resume")
    recorder._append("assistant_output_completed", session=StudioSession())

    rows, _ = store.read_events("partial-run")
    assert rows[0].type == "ledger_gap"
    assert rows[-1].unbranchable_reason == "ledger_gap"
    assert rows[-1].checkpoint_ref is None


async def test_recorder_failure_does_not_change_runtime_final() -> None:
    class _BrokenRecorder:
        current_run_id = None

        def start_turn(self, **_kwargs):
            raise RuntimeError("ledger unavailable")

        def observe(self, *_args, **_kwargs):
            raise RuntimeError("ledger unavailable")

        def finish(self, *_args, **_kwargs):
            raise RuntimeError("ledger unavailable")

    session = StudioSession()
    session.session_id = "session-broken-ledger"
    runtime = AgentRuntime(_TextLLM(), _ApproveGate(), run_recorder=_BrokenRecorder())
    events = [event async for event in runtime.run_turn("hello", session)]
    assert events[-1].type == EventType.FINAL.value
    assert events[-1].data["text"] == "final answer"


async def test_user_stop_closes_replay_run_as_interrupted(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    session = StudioSession()
    session.session_id = "session-r"
    runtime = AgentRuntime(_TextLLM(), _ApproveGate(), run_recorder=recorder)

    events = [
        event
        async for event in runtime.run_turn("hello", session, should_stop=lambda: True)
    ]

    assert events[-1].type == EventType.ERROR.value
    assert store.list_runs("session-r")[0].status == "interrupted"
