"""Tests for projecting the crash-resume anchor from the replay ledger.

Author: Damon Li
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.contracts import MAX_INLINE_PAYLOAD_BYTES
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.runtime.replay_ledger.resume_anchor import project_resume_anchor

SID = "session-anchor"


def _recorder(store: ReplayLedgerStore) -> ReplayLedgerRecorder:
    return ReplayLedgerRecorder(
        store=store,
        session_id=SID,
        agent_id="meta",
        provider="test",
        model="test-model",
    )


def _observe(
    recorder: ReplayLedgerRecorder, event_type: str, data: dict, round_idx: int | None = None
) -> None:
    recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)


def _open_crashed_run(store: ReplayLedgerStore) -> tuple[str, ReplayLedgerRecorder]:
    """Reach round 3, dispatch c2, then "crash": the run is never finished."""
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-anchor", user_input="帮我完成两步任务")
    _observe(recorder, "round_start", {"round": 1}, 1)
    _observe(
        recorder,
        "tool_call",
        {"name": "todo_write", "arguments": {"todos": []}, "tool_call_id": "c1"},
        1,
    )
    _observe(recorder, "tool_result", {"name": "todo_write", "result": "ok", "tool_call_id": "c1"}, 1)
    _observe(recorder, "round_start", {"round": 2}, 2)
    _observe(recorder, "round_start", {"round": 3}, 3)
    _observe(
        recorder,
        "tool_call",
        {"name": "file_write", "arguments": {"path": "a.txt", "content": "x"}, "tool_call_id": "c2"},
        3,
    )
    return run_id, recorder


def test_dispatched_tool_call_without_result_is_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, _recorder_after_crash = _open_crashed_run(store)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.turn_id == "turn-anchor"
    assert checkpoint.session_id == SID
    assert checkpoint.round_idx == 2  # the resumed turn re-enters at round 3
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state is None
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    call = checkpoint.pending_tool_calls[0]
    assert call["type"] == "function"
    assert call["function"]["name"] == "file_write"
    assert json.loads(call["function"]["arguments"]) == {"path": "a.txt", "content": "x"}


def test_unanswered_confirm_is_projected_as_awaiting_confirm(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "file_write", "request_id": "req-9"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-9", "question": "允许写入吗？", "context": context},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.status == "awaiting_confirm"
    assert checkpoint.confirm_state == {
        "pending": [{"request_id": "req-9", "question": "允许写入吗？", "context": context}],
        "last_request": {"id": "req-9", "question": "允许写入吗？", "context": context},
    }


def test_answered_confirm_leaves_no_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "file_write", "request_id": "req-9"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-9", "question": "允许写入吗？", "context": context},
        3,
    )
    _observe(recorder, "confirm_response", {"id": "req-9", "approved": True}, 3)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state == {
        "pending": [],
        "last_request": {"id": "req-9", "question": "允许写入吗？", "context": context},
    }


def test_retried_tool_call_with_same_id_follows_the_latest_attempt(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-retry", user_input="go")
    _observe(recorder, "round_start", {"round": 1}, 1)
    _observe(recorder, "tool_call", {"name": "file_read", "arguments": {"path": "a"}, "tool_call_id": "c1"}, 1)
    _observe(recorder, "tool_result", {"name": "file_read", "result": "a", "tool_call_id": "c1"}, 1)
    _observe(recorder, "tool_call", {"name": "file_read", "arguments": {"path": "b"}, "tool_call_id": "c1"}, 1)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c1"]
    assert json.loads(checkpoint.pending_tool_calls[0]["function"]["arguments"]) == {"path": "b"}


def test_all_results_recorded_resumes_at_the_next_round_with_no_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    _observe(recorder, "tool_result", {"name": "file_write", "result": "done", "tool_call_id": "c2"}, 3)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.round_idx == 2
    assert checkpoint.pending_tool_calls == []


def test_crash_before_first_round_resumes_at_round_one(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-early", user_input="go")

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.round_idx == 0
    assert checkpoint.pending_tool_calls == []


def test_closed_runs_and_missing_ledgers_are_not_resumable(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    assert project_resume_anchor(store, SID) is None  # no ledger at all

    _run_id, recorder = _open_crashed_run(store)
    recorder.finish("interrupted")
    assert project_resume_anchor(store, SID) is None  # the run was closed


def test_clarification_and_subagent_events_do_not_change_the_anchor(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, recorder = _open_crashed_run(store)
    recorded_before = len(store.read_events(run_id)[0])
    _observe(recorder, "subagent_started", {"agent_id": "sub-1", "task": "x"}, 3)
    assert len(store.read_events(run_id)[0]) == recorded_before  # never recorded
    _observe(
        recorder,
        "clarification_required",
        {"id": "clar-1", "question": "哪个文件？", "options": ["a", "b"]},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.round_idx == 2
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state is None


def test_large_confirm_context_is_restored_from_blob(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "bash", "command": "echo " + "y" * MAX_INLINE_PAYLOAD_BYTES, "request_id": "req-big"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-big", "question": "允许执行吗？", "context": context},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.confirm_state["pending"][0]["context"] == context


def test_gapped_run_is_not_projected(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, _recorder = _open_crashed_run(store)
    store.mark_partial(run_id, "ledger_append_failed")

    # Rows may be missing, so "dispatched" cannot be told from "not started".
    assert project_resume_anchor(store, SID) is None


def test_stale_open_run_does_not_shadow_a_newer_turn(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _stale_run_id, _stale_recorder = _open_crashed_run(store)  # never closed
    time.sleep(0.01)  # make the newer run strictly newer than the stale one
    newer = _recorder(store)
    newer.start_turn(turn_id="turn-newer", user_input="继续")
    newer.finish("interrupted")

    assert project_resume_anchor(store, SID) is None
