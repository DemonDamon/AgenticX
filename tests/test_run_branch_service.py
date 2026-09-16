#!/usr/bin/env python3
"""Tests for replay branch checkpoint resolution and session creation.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.runtime.replay_ledger.branch_service import (
    BranchConflictError,
    BranchService,
    BranchServiceError,
    resolve_branch_checkpoint,
)
from agenticx.runtime.replay_ledger.contracts import (
    ContextCheckpoint,
    ReplayRunRecord,
    RunEvent,
    WorkspaceSnapshotRef,
)
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder


def _event(
    seq: int,
    event_type: str,
    *,
    branchable: bool = False,
    event_id: str | None = None,
) -> RunEvent:
    return RunEvent(
        event_id=event_id or f"event-{seq}",
        run_id="run-a",
        session_id="source-session",
        turn_id="turn-a",
        seq=seq,
        ts=float(seq),
        type=event_type,
        agent_id="meta",
        branchable=branchable,
        checkpoint_ref=f"checkpoint-{seq}" if branchable else None,
    )


def test_tool_call_resolves_to_prior_stable_checkpoint() -> None:
    events = [
        _event(100, "tool_result", branchable=True),
        _event(101, "tool_call"),
        _event(102, "tool_result", branchable=True),
    ]
    resolved, reason = resolve_branch_checkpoint(
        events=events,
        requested_event_id="event-101",
    )
    assert reason == ""
    assert resolved is not None
    assert resolved.seq == 100


def test_resolution_does_not_cross_ledger_gap() -> None:
    events = [
        _event(10, "tool_result", branchable=True),
        _event(11, "ledger_gap"),
        _event(12, "tool_call"),
    ]
    resolved, reason = resolve_branch_checkpoint(
        events=events,
        requested_event_id="event-12",
    )
    assert resolved is None
    assert reason == "no_stable_checkpoint"


def test_middle_result_in_parallel_batch_resolves_before_batch_checkpoint() -> None:
    events = [
        _event(20, "tool_result", branchable=True),
        _event(21, "tool_call"),
        _event(22, "tool_call"),
        _event(23, "tool_result"),
        _event(24, "tool_result", branchable=True),
    ]

    resolved, reason = resolve_branch_checkpoint(
        events=events,
        requested_event_id="event-23",
    )

    assert reason == ""
    assert resolved is not None
    assert resolved.seq == 20


class _Managed:
    def __init__(self, execution_state: str = "idle") -> None:
        self.execution_state = execution_state


class _Manager:
    def __init__(self, execution_state: str = "idle") -> None:
        self.source = _Managed(execution_state)
        self.calls: list[dict] = []
        self.deleted: list[str] = []

    def get(self, session_id: str, *, touch: bool = False):
        return self.source if session_id == "source-session" else None

    def fork_session_from_checkpoint(self, **kwargs):
        self.calls.append(kwargs)
        return type(
            "Forked",
            (),
            {"session_id": kwargs["target_session_id"]},
        )()

    def delete(self, session_id: str) -> bool:
        self.deleted.append(session_id)
        return True


def _seed(tmp_path: Path) -> tuple[ReplayLedgerStore, RunEvent]:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(
        ReplayRunRecord(
            run_id="run-a",
            session_id="source-session",
            turn_id="turn-a",
            agent_id="meta",
            status="completed",
            created_at=1,
            updated_at=2,
            completed_at=2,
        )
    )
    checkpoint = ContextCheckpoint(
        agent_messages=[{"role": "user", "content": "prefix"}],
        chat_history=[{"id": "m1", "role": "user", "content": "prefix"}],
        context_files={},
        taskspaces=[],
        active_taskspace_id=None,
        scratchpad={},
        artifacts={},
        todo_items=[],
        provider="p1",
        model="m1",
        session_mode="code_dev",
        system_prompt_sha256="0" * 64,
        workspace_ref=None,
    )
    checkpoint_ref = store.write_checkpoint("run-a", checkpoint)
    workspace_ref = store.write_blob(
        "run-a",
        WorkspaceSnapshotRef(mode="none", branchable=True).to_dict(),
    )
    checkpoint.workspace_ref = workspace_ref
    checkpoint_ref = store.write_checkpoint("run-a", checkpoint)
    stable = _event(100, "tool_result", branchable=True)
    stable.seq = 0
    stable.checkpoint_ref = checkpoint_ref
    stable.workspace_ref = workspace_ref
    store.append_event("run-a", stable)
    call = _event(101, "tool_call")
    call.seq = 0
    call.effect_class = "unknown"
    call.title = "mcp_call"
    store.append_event("run-a", call)
    return store, call


def test_create_branch_restores_checkpoint_and_returns_lineage(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store, _ = _seed(tmp_path)
    manager = _Manager()
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.branch_service.restore_git_workspace_snapshot",
        lambda snapshot, target_session_id: {},
    )
    result = BranchService(store=store, manager=manager).create_branch(
        source_run_id="run-a",
        source_event_id="event-101",
        instruction="continue differently",
        provider="p2",
        model="m2",
    )
    assert result["requested_event"]["seq"] == 2
    assert result["resolved_event"]["seq"] == 1
    assert result["source_run_id"] == "run-a"
    assert result["resolved_checkpoint_seq"] == 1
    assert result["instruction"] == "continue differently"
    assert manager.calls[0]["checkpoint"].agent_messages == [
        {"role": "user", "content": "prefix"}
    ]
    assert manager.calls[0]["provider"] == "p2"
    assert result["warnings"] == []
    assert store.get_run("run-a").branch_count == 1


def test_running_source_is_rejected(tmp_path: Path) -> None:
    store, _ = _seed(tmp_path)
    with pytest.raises(BranchConflictError, match="source_session_running"):
        BranchService(store=store, manager=_Manager("running")).create_branch(
            source_run_id="run-a",
            source_event_id="event-101",
            instruction="continue",
        )


@pytest.mark.parametrize(
    ("completeness", "gap_reason"),
    [
        ("partial", None),
        ("complete", "checkpoint_write_failed"),
    ],
)
def test_incomplete_run_is_rejected_with_stable_conflict_code(
    tmp_path: Path,
    completeness: str,
    gap_reason: str | None,
) -> None:
    store, _ = _seed(tmp_path)
    record = store.get_run("run-a")
    assert record is not None
    record.completeness = completeness
    record.gap_reason = gap_reason
    store._write_json_atomic(
        tmp_path / "source-session" / "runs" / "run-a" / "run.json",
        record.to_dict(),
    )

    with pytest.raises(BranchConflictError) as captured:
        BranchService(store=store, manager=_Manager()).create_branch(
            source_run_id="run-a",
            source_event_id="event-101",
            instruction="continue",
        )

    assert captured.value.status_code == 409
    assert captured.value.code == "run_incomplete"


def test_corrupt_event_discovered_during_read_is_rejected_as_incomplete(
    tmp_path: Path,
) -> None:
    store, _ = _seed(tmp_path)
    events_path = tmp_path / "source-session" / "runs" / "run-a" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write("{corrupt\n")

    with pytest.raises(BranchConflictError) as captured:
        BranchService(store=store, manager=_Manager()).create_branch(
            source_run_id="run-a",
            source_event_id="event-101",
            instruction="continue",
        )

    assert captured.value.code == "run_incomplete"


def test_restore_stage_error_keeps_stable_code(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store, _ = _seed(tmp_path)
    snapshot_ref = store.write_blob(
        "run-a",
        WorkspaceSnapshotRef(
            mode="git",
            branchable=True,
            tree_oid="1" * 40,
            base_sha="2" * 40,
            repo_root=str(tmp_path),
        ).to_dict(),
    )
    events = store.read_events("run-a")[0]
    checkpoint = store.read_checkpoint("run-a", str(events[0].checkpoint_ref))
    assert checkpoint is not None
    checkpoint.workspace_ref = snapshot_ref
    monkeypatch.setattr(store, "read_checkpoint", lambda *_args: checkpoint)
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.branch_service.restore_git_workspace_snapshot",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("workspace_restore_failed:read_tree")
        ),
    )

    with pytest.raises(BranchServiceError) as captured:
        BranchService(store=store, manager=_Manager()).create_branch(
            source_run_id="run-a",
            source_event_id="event-101",
            instruction="continue",
        )

    assert captured.value.status_code == 500
    assert captured.value.code == "workspace_restore_failed:read_tree"


def test_branch_count_failure_removes_created_child_session(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store, _ = _seed(tmp_path)
    manager = _Manager()
    monkeypatch.setattr(
        store,
        "increment_branch_count",
        lambda _run_id: (_ for _ in ()).throw(OSError("metadata unavailable")),
    )

    with pytest.raises(BranchServiceError) as captured:
        BranchService(store=store, manager=manager).create_branch(
            source_run_id="run-a",
            source_event_id="event-101",
            instruction="continue",
        )

    assert captured.value.code == "branch_lineage_persist_failed"
    assert len(manager.deleted) == 1


def test_first_run_in_branch_persists_parent_lineage(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="child-session",
        agent_id="meta",
        provider="p",
        model="m",
        branch_lineage={
            "parent_run_id": "run-a",
            "source_event_id": "event-101",
            "source_seq": 101,
        },
    )
    run_id = recorder.start_turn(turn_id="child-turn", user_input="continue")
    record = store.get_run(run_id)
    assert record is not None
    assert record.parent_run_id == "run-a"
    assert record.forked_from_event_id == "event-101"
    assert record.forked_from_seq == 101
