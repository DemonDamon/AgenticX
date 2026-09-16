#!/usr/bin/env python3
"""Tests for branch-safe runtime context checkpoints.

Author: Damon Li
"""

from __future__ import annotations

from concurrent.futures import Future
from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.runtime.replay_ledger.context_checkpoint import (
    capture_context_checkpoint,
    context_is_branch_stable,
    latest_tool_batch_is_complete,
)
from agenticx.runtime.replay_ledger.contracts import (
    ReplayRunRecord,
    RunEvent,
    WorkspaceSnapshotRef,
)
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.runtime.events import RuntimeEvent


def _event(event_type: str, seq: int = 1) -> RunEvent:
    return RunEvent(
        event_id=f"event-{seq}",
        run_id="run-a",
        session_id="session-a",
        turn_id="turn-a",
        seq=seq,
        ts=float(seq),
        type=event_type,
        agent_id="meta",
    )


def _parallel_messages(result_count: int) -> list[dict]:
    rows: list[dict] = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": f"call-{index}",
                    "type": "function",
                    "function": {"name": "x", "arguments": "{}"},
                }
                for index in range(3)
            ],
        }
    ]
    rows.extend(
        {"role": "tool", "tool_call_id": f"call-{index}", "content": "ok"}
        for index in range(result_count)
    )
    return rows


def test_parallel_tool_batch_requires_every_result() -> None:
    assert latest_tool_batch_is_complete(_parallel_messages(2)) is False
    assert latest_tool_batch_is_complete(_parallel_messages(3)) is True


def test_stable_boundary_rejects_pending_events_and_accepts_complete_result() -> None:
    assert context_is_branch_stable(_event("tool_result"), _parallel_messages(3)) == (
        True,
        "",
    )
    assert context_is_branch_stable(_event("tool_result"), _parallel_messages(2)) == (
        False,
        "incomplete_tool_batch",
    )
    assert context_is_branch_stable(_event("confirm_required"), []) == (
        False,
        "pending_confirm",
    )
    gap = _event("tool_result")
    gap.payload["ledger_gap_before"] = True
    assert context_is_branch_stable(gap, _parallel_messages(3)) == (
        False,
        "ledger_gap",
    )


def test_interaction_response_requires_matching_context_entry() -> None:
    event = _event("confirm_response")
    event.payload = {"id": "confirm-42", "approved": True}
    assert context_is_branch_stable(
        event,
        [{"role": "assistant", "content": "unrelated"}],
    ) == (False, "confirm_response_not_in_context")
    assert context_is_branch_stable(
        event,
        [
            {
                "role": "tool",
                "content": "approved",
                "metadata": {"interaction_id": "confirm-42"},
            }
        ],
    ) == (True, "")


def test_one_hundred_complete_tool_boundaries_are_stable() -> None:
    messages = _parallel_messages(3)
    for seq in range(1, 101):
        assert context_is_branch_stable(_event("tool_result", seq), messages) == (
            True,
            "",
        )


def test_checkpoint_filters_live_values_and_roundtrips_content_addressed(
    tmp_path: Path,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="run-a",
            session_id="session-a",
            turn_id="turn-a",
            agent_id="meta",
            status="running",
            created_at=1,
            updated_at=1,
        )
    )
    session = StudioSession(provider_name="provider-a", model_name="model-a")
    session.agent_messages = _parallel_messages(3)
    session.chat_history = [
        {"id": "m1", "role": "user", "content": "hello", "timestamp": 1}
    ]
    session.context_files = {"a.py": "/repo/a.py"}
    session.scratchpad = {
        "plan_mode": "true",
        "subagent_result::x": {"ok": True},
        "confirm_future": Future(),
        "mcp_hub": object(),
        "mcp_configs": {"server": "live"},
        "connected_servers": ["server"],
        "tool_allowlist_once": ["bash_exec"],
        "approval_cache": {"bash_exec": True},
    }
    session.artifacts = {Path("out.txt"): "artifact"}
    session.session_mode = "code_dev"
    setattr(session, "taskspaces", [{"id": "repo", "path": "/repo"}])
    setattr(session, "active_taskspace_id", "repo")

    first, warnings = capture_context_checkpoint(session, workspace_ref="tree-1")
    second, _ = capture_context_checkpoint(session, workspace_ref="tree-1")
    first_ref = store.write_checkpoint("run-a", first)
    second_ref = store.write_checkpoint("run-a", second)

    assert warnings
    assert first_ref == second_ref
    restored = store.read_checkpoint("run-a", first_ref)
    assert restored is not None
    assert restored.context_files == {"a.py": "/repo/a.py"}
    assert restored.taskspaces == [{"id": "repo", "path": "/repo"}]
    assert restored.active_taskspace_id == "repo"
    assert "confirm_future" not in restored.scratchpad
    assert "mcp_hub" not in restored.scratchpad
    assert "mcp_configs" not in restored.scratchpad
    assert "connected_servers" not in restored.scratchpad
    assert "tool_allowlist_once" not in restored.scratchpad
    assert "approval_cache" not in restored.scratchpad
    assert latest_tool_batch_is_complete(restored.agent_messages)


def test_recorder_marks_complete_tool_result_branchable_with_checkpoint(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path))
    store = ReplayLedgerStore(tmp_path / "sessions")
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-a",
        agent_id="meta",
        provider="test",
        model="model",
    )
    session = StudioSession()
    session.agent_messages = _parallel_messages(3)
    run_id = recorder.start_turn(turn_id="turn-a", user_input="work")

    recorder.observe(
        RuntimeEvent(
            "tool_call",
            {"name": "file_read", "arguments": {}, "tool_call_id": "call-ledger"},
        ),
        session=session,
    )
    recorder.observe(
        RuntimeEvent(
            "tool_result",
            {"name": "file_read", "result": "ok", "tool_call_id": "call-ledger"},
        ),
        session=session,
    )

    result = store.read_events(run_id)[0][-1]
    assert result.checkpoint_ref
    assert result.branchable is False
    assert result.unbranchable_reason == "not_git_isolate"
    assert store.read_checkpoint(run_id, result.checkpoint_ref) is not None


def test_start_turn_captures_initial_tree_once_and_reuses_for_read_only_boundaries(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path / "sessions")
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-a",
        agent_id="meta",
        provider="test",
        model="model",
    )
    session = StudioSession()
    captures: list[int] = []

    def capture(*_args, seq: int, **_kwargs):
        captures.append(seq)
        return WorkspaceSnapshotRef(
            mode="git",
            branchable=True,
            tree_oid="1" * 40,
            base_sha="2" * 40,
            repo_root=str(tmp_path),
            ref_name="refs/agenticx/replay/session-a/run-a/tree",
        )

    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.capture_git_workspace_snapshot",
        capture,
    )
    run_id = recorder.start_turn(
        turn_id="turn-a",
        user_input="work",
        session=session,
    )
    recorder._append("assistant_output_completed", session=session)
    recorder._append("assistant_output_completed", session=session)

    stable = [
        event
        for event in store.read_events(run_id)[0]
        if event.type == "assistant_output_completed"
    ]
    assert captures == [1]
    assert len(stable) == 2
    assert stable[0].workspace_ref == stable[1].workspace_ref
    assert all(event.branchable for event in stable)


def test_failed_initial_tree_capture_cannot_become_branchable(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path / "sessions")
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-a",
        agent_id="meta",
        provider="test",
        model="model",
    )
    session = StudioSession()
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.capture_git_workspace_snapshot",
        lambda *_args, **_kwargs: WorkspaceSnapshotRef(
            mode="git",
            branchable=False,
            reason="workspace_snapshot_failed",
        ),
    )
    run_id = recorder.start_turn(
        turn_id="turn-a",
        user_input="work",
        session=session,
    )

    recorder._append("assistant_output_completed", session=session)

    event = store.read_events(run_id)[0][-1]
    assert event.branchable is False
    assert event.unbranchable_reason == "workspace_snapshot_failed"


def test_one_hundred_stable_boundaries_persist_readable_checkpoints(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path / "sessions")
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-a",
        agent_id="meta",
        provider="test",
        model="model",
    )
    session = StudioSession()
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.capture_git_workspace_snapshot",
        lambda *_args, **_kwargs: WorkspaceSnapshotRef(
            mode="git",
            branchable=True,
            tree_oid="1" * 40,
            base_sha="2" * 40,
            repo_root=str(tmp_path),
            ref_name="refs/agenticx/replay/session-a/run-a/tree",
        ),
    )
    run_id = recorder.start_turn(
        turn_id="turn-a",
        user_input="work",
        session=session,
    )

    for _ in range(100):
        recorder._append("assistant_output_completed", session=session)

    stable = [
        event
        for event in store.read_events(run_id, limit=200)[0]
        if event.type == "assistant_output_completed"
    ]
    assert len(stable) == 100
    assert all(event.checkpoint_ref for event in stable)
    assert all(
        store.read_checkpoint(run_id, str(event.checkpoint_ref)) is not None
        for event in stable
    )
    record = store.get_run(run_id)
    assert record is not None
    assert record.checkpoint_count == 100
