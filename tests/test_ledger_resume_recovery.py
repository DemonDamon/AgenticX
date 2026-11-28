"""Tests for recovery layering: ledger-projected anchors in standalone mode,
checkpoint anchors in HA mode and when the switch is off.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime.checkpoint import AgentCheckpoint, CheckpointStore, load_resume_anchor
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.studio.session_manager import SessionManager
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.local_file import LocalFileBackend

SID = "crash-ledger-1"


def _checkpoint_store(tmp_path: Path) -> CheckpointStore:
    backend = LocalFileBackend(
        sessions_root=tmp_path / "sessions",
        config_dir=tmp_path / "cfg",
    )
    return CheckpointStore(SyncStorageFacade(backend))


def _no_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep config and env from leaking the developer's shell into the test."""
    monkeypatch.setattr(ConfigManager, "get_value", lambda key, default=None: None)
    for name in ("AGX_RESUME_FROM_LEDGER", "AGX_HA_MODE", "AGX_STORAGE_BACKEND"):
        monkeypatch.delenv(name, raising=False)


def _open_ledger_run(sessions_root: Path, sid: str = SID, finish: str | None = None) -> str:
    """Round 3 dispatched c2 and asked for confirmation; then the process "crashed"."""
    sessions_root.mkdir(parents=True, exist_ok=True)
    store = ReplayLedgerStore(sessions_root)
    recorder = ReplayLedgerRecorder(
        store=store, session_id=sid, agent_id="meta", provider="test", model="test-model"
    )
    run_id = recorder.start_turn(turn_id="t-crash", user_input="帮我完成两步任务")
    for event_type, data, round_idx in (
        ("round_start", {"round": 1}, 1),
        ("tool_call", {"name": "todo_write", "arguments": {}, "tool_call_id": "c1"}, 1),
        ("tool_result", {"name": "todo_write", "result": "ok", "tool_call_id": "c1"}, 1),
        ("round_start", {"round": 2}, 2),
        ("round_start", {"round": 3}, 3),
        ("tool_call", {"name": "file_write", "arguments": {"path": "a.txt"}, "tool_call_id": "c2"}, 3),
        (
            "confirm_required",
            {"id": "req-9", "question": "允许写入吗？", "context": {"tool": "file_write", "request_id": "req-9"}},
            3,
        ),
    ):
        recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)
    if finish is not None:
        recorder.finish(finish)
    return run_id


def _legacy_checkpoint(sid: str = SID) -> AgentCheckpoint:
    return AgentCheckpoint(session_id=sid, turn_id="t-legacy", round_idx=7, status="in_progress")


def _seed_crashed_session(tmp_path: Path, sid: str = SID) -> tuple[SessionStore, Path]:
    """Same on-disk shape as tests/test_ha_checkpoint_resume.py: a dangling c2 call."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    session_dir = sessions_root / sid
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps([{"role": "user", "content": "帮我完成两步任务"}], ensure_ascii=False),
        encoding="utf-8",
    )
    agent_messages = [
        {"role": "user", "content": "帮我完成两步任务"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "todo_write", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "c1", "name": "todo_write", "content": "ok"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c2", "type": "function", "function": {"name": "file_write", "arguments": "{}"}}],
        },
    ]
    (session_dir / "agent_messages.json").write_text(
        json.dumps(agent_messages, ensure_ascii=False), encoding="utf-8"
    )
    store._save_session_summary_sync(
        sid,
        "帮我完成两步任务",
        {"execution_state": "running", "created_at": 1.0, "updated_at": 1.0},
    )
    return store, sessions_root


def test_load_resume_anchor_prefers_the_open_ledger_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    sessions_root = tmp_path / "sessions"
    run_id = _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.turn_id == "t-crash"
    assert checkpoint.round_idx == 2
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    assert checkpoint.status == "awaiting_confirm"


def test_load_resume_anchor_falls_back_to_checkpoint_without_open_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root, finish="interrupted")  # closed: nothing to project
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7

    cp_store.clear(SID)
    empty_root = tmp_path / "elsewhere"
    assert load_resume_anchor(SID, sessions_root=empty_root, checkpoint_store=cp_store) is None


def test_switch_off_restores_the_checkpoint_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_FROM_LEDGER", "0")
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7


def test_ha_mode_keeps_the_checkpoint_store_as_recovery_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_HA_MODE", "redis")
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7


async def test_resume_interrupted_sessions_recovers_from_the_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    session_store, sessions_root = _seed_crashed_session(tmp_path)
    run_id = _open_ledger_run(sessions_root)

    manager = SessionManager()
    manager._session_store = session_store
    manager._sessions_root = str(sessions_root)

    # Route the manager's CheckpointStore (constructed internally) to a tmp backend.
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()

    seen: dict[str, Any] = {}

    async def _fake_runner(session_id: str, managed, checkpoint) -> bool:
        seen["round_idx"] = checkpoint.round_idx
        seen["run_id"] = checkpoint.run_id
        seen["turn_id"] = checkpoint.turn_id
        seen["pending_ids"] = [call["id"] for call in checkpoint.pending_tool_calls]
        # AC-3: the open confirmation question is back in the gate.
        pending = managed.confirm_gate.export_state()["pending"]
        seen["pending_confirms"] = [item["request_id"] for item in pending]
        # AC-2: the dispatched call is closed as "outcome unknown", not re-executed.
        closers = [
            message
            for message in managed.studio_session.agent_messages
            if message.get("role") == "tool" and message.get("tool_call_id") == "c2"
        ]
        seen["closer_contents"] = [str(message.get("content")) for message in closers]
        return True

    # No checkpoint is saved anywhere: the ledger alone drives the resume.
    resumed = await manager.resume_interrupted_sessions(runtime_runner=_fake_runner)

    assert resumed == [SID]
    assert seen["round_idx"] == 2  # re-enters at round 3, exactly like the checkpoint path
    assert seen["run_id"] == run_id
    assert seen["turn_id"] == "t-crash"
    assert seen["pending_ids"] == ["c2"]
    assert seen["pending_confirms"] == ["req-9"]
    assert len(seen["closer_contents"]) == 1
    assert "执行结果未知" in seen["closer_contents"][0]
    assert "尚未开始执行" not in seen["closer_contents"][0]
    managed = manager.get(SID, touch=False)
    assert managed is not None
    assert managed.execution_state == "idle"


async def test_in_flight_turn_is_not_overwritten_by_persisted_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    session_store, sessions_root = _seed_crashed_session(tmp_path)
    _open_ledger_run(sessions_root)

    manager = SessionManager()
    manager._session_store = session_store
    manager._sessions_root = str(sessions_root)
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()

    # A newer turn is already in flight in memory: one row the disk does not have.
    managed = manager.get(SID, touch=False)
    assert managed is not None
    in_flight = list(managed.studio_session.agent_messages) + [
        {"role": "user", "content": "新的一轮"}
    ]
    managed.studio_session.agent_messages = list(in_flight)
    seen: dict[str, Any] = {}

    async def _fake_runner(session_id: str, managed, checkpoint) -> bool:
        seen["rows"] = list(managed.studio_session.agent_messages)
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_fake_runner)

    assert resumed == [SID]
    assert seen["rows"] == in_flight  # nothing lost, no closer synthesized
