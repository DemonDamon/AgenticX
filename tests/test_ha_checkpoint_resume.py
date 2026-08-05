#!/usr/bin/env python3
"""Tests for agent run checkpointing and crash resume (HA Plan B).

Covers:
- AC-1: CheckpointStore roundtrip/clear on local + redis backends;
- AC-2: per-round checkpoint writes and clear-on-FINAL in run_turn;
- AC-3: AsyncConfirmGate export_state/restore_state;
- AC-4: resume_interrupted_sessions re-enters at round N+1 with a sanitized
  context, then clears the checkpoint and returns the session to idle;
- AC-5: resume is disabled by default;
- abnormal termination (generator close) keeps the checkpoint.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.checkpoint import (
    RESUME_SYSTEM_HINT,
    AgentCheckpoint,
    CheckpointStore,
    resume_interrupted_enabled,
)
from agenticx.runtime.confirm import AsyncConfirmGate
from agenticx.studio.session_manager import SessionManager
from agenticx.studio.storage.factory import get_sync_storage
from agenticx.studio.storage.local_file import LocalFileBackend
from agenticx.studio.storage.redis_backend import RedisSessionStorage
from agenticx.studio.storage.backend import SyncStorageFacade


def _local_store(tmp_path: Path) -> CheckpointStore:
    backend = LocalFileBackend(
        sessions_root=tmp_path / "sessions",
        config_dir=tmp_path / "cfg",
    )
    return CheckpointStore(SyncStorageFacade(backend))


def _redis_store() -> CheckpointStore:
    fakeredis = pytest.importorskip("fakeredis.aioredis")
    from agenticx.server.redis_backend import RedisBackend

    rb = RedisBackend(url="redis://test/0")
    rb._client = fakeredis.FakeRedis(decode_responses=True)
    rb._connected = True
    return CheckpointStore(SyncStorageFacade(RedisSessionStorage(redis_backend=rb)))


# ── AC-1: store contract ──


def test_checkpoint_store_roundtrip_local(tmp_path: Path) -> None:
    store = _local_store(tmp_path)
    cp = AgentCheckpoint(session_id="s1", turn_id="t1", round_idx=2, status="in_progress")
    store.save(cp)
    loaded = store.load("s1")
    assert loaded is not None
    assert loaded.session_id == "s1"
    assert loaded.round_idx == 2
    assert loaded.status == "in_progress"
    assert loaded.created_at > 0
    store.clear("s1")
    assert store.load("s1") is None


def test_checkpoint_store_roundtrip_redis() -> None:
    store = _redis_store()
    cp = AgentCheckpoint(
        session_id="s2",
        turn_id="t2",
        round_idx=1,
        pending_tool_calls=[{"id": "c1", "function": {"name": "todo_write"}}],
    )
    store.save(cp)
    loaded = store.load("s2")
    assert loaded is not None
    assert loaded.pending_tool_calls[0]["id"] == "c1"
    store.clear("s2")
    assert store.load("s2") is None


def test_checkpoint_store_missing_and_corrupt(tmp_path: Path) -> None:
    store = _local_store(tmp_path)
    assert store.load("nope") is None
    backend = LocalFileBackend(
        sessions_root=tmp_path / "sessions", config_dir=tmp_path / "cfg"
    )
    backend.save_agent_state_sync("bad", {"checkpoint": {"round_idx": "not-an-int"}})
    assert store.load("bad") is None


# ── AC-2/AC-4 helpers: fake LLMs and recording store ──


class _FakeResponse:
    def __init__(self, content: str, tool_calls, *, finish_reason: str = ""):
        self.content = content
        self.tool_calls = tool_calls
        self.finish_reason = finish_reason
        self.reasoning_content = ""


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _TwoToolRoundsThenFinal:
    """Rounds 1-2 dispatch todo_write; round 3 answers with final text."""

    def __init__(self) -> None:
        self.calls = 0
        self.messages_seen: List[List[Dict[str, Any]]] = []

    def invoke(self, messages, **_kwargs):
        self.calls += 1
        self.messages_seen.append([dict(m) for m in messages])
        if self.calls <= 2:
            return _FakeResponse(
                " ",
                [
                    {
                        "id": f"call-{self.calls}",
                        "type": "function",
                        "function": {
                            "name": "todo_write",
                            "arguments": json.dumps(
                                {"todos": [{"content": f"step {self.calls}", "status": "pending"}]}
                            ),
                        },
                    }
                ],
            )
        return _FakeResponse("全部完成", [], finish_reason="stop")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _TextOnlyLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("done", [], finish_reason="stop")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _RecordingStore:
    def __init__(self) -> None:
        self.saves: List[Dict[str, Any]] = []
        self.cleared: List[str] = []

    def new_turn_id(self) -> str:
        return "turn-test-1"

    def save(self, checkpoint: AgentCheckpoint) -> None:
        self.saves.append(checkpoint.model_dump())

    def load(self, session_id: str):
        return None

    def clear(self, session_id: str) -> None:
        self.cleared.append(session_id)


def _collect_events(runtime: AgentRuntime, session: StudioSession, text: str, **kwargs):
    async def _run() -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        async for event in runtime.run_turn(text, session, **kwargs):
            events.append({"type": event.type, "data": event.data})
        return events

    import asyncio

    return asyncio.run(_run())


# ── AC-2: per-round checkpoint writes ──


def test_checkpoint_written_per_round_and_cleared_on_final() -> None:
    store = _RecordingStore()
    session = StudioSession()
    session.session_id = "sess-rounds"
    runtime = AgentRuntime(_TwoToolRoundsThenFinal(), _ApproveGate(), checkpoint_store=store)

    events = _collect_events(runtime, session, "do two steps")

    assert events[-1]["type"] == EventType.FINAL.value
    rounds = [s["round_idx"] for s in store.saves]
    # entry(0) + round1 top(0) + round1 pending(0) + round2 top(1)
    # + round2 pending(1) + round3 top(2)
    assert rounds == [0, 0, 0, 1, 1, 2]
    pending_marks = [len(s["pending_tool_calls"]) for s in store.saves]
    assert pending_marks == [0, 0, 1, 0, 1, 0]
    assert store.cleared == ["sess-rounds"]


def test_checkpoint_cleared_on_plain_text_turn() -> None:
    store = _RecordingStore()
    session = StudioSession()
    session.session_id = "sess-plain"
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate(), checkpoint_store=store)

    events = _collect_events(runtime, session, "hello")

    assert events[-1]["type"] == EventType.FINAL.value
    assert store.cleared == ["sess-plain"]


async def test_checkpoint_kept_on_abnormal_close() -> None:
    store = _RecordingStore()
    session = StudioSession()
    session.session_id = "sess-crash"
    runtime = AgentRuntime(_TwoToolRoundsThenFinal(), _ApproveGate(), checkpoint_store=store)

    agen = runtime.run_turn("do two steps", session)
    first = await agen.__anext__()
    assert first.type == EventType.ROUND_START.value
    await agen.aclose()  # simulates crash/cancellation of the turn

    assert store.saves  # entry checkpoint written
    assert store.cleared == []  # but nothing cleared


# ── AC-3: confirm gate export/restore ──


async def test_confirm_gate_export_restore() -> None:
    import asyncio

    gate = AsyncConfirmGate(timeout_seconds=30)
    task = asyncio.create_task(gate.request_confirm("允许删除吗？", {"request_id": "req-1"}))
    await asyncio.sleep(0)
    exported = gate.export_state()
    assert [p["request_id"] for p in exported["pending"]] == ["req-1"]
    assert exported["pending"][0]["question"] == "允许删除吗？"
    assert exported["last_request"]["id"] == "req-1"

    restored = AsyncConfirmGate(timeout_seconds=30)
    restored.restore_state(exported)
    assert list(restored._pending.keys()) == ["req-1"]
    assert restored.last_request["question"] == "允许删除吗？"
    assert restored.resolve("req-1", True) is True

    # The original gate still owns the in-flight request; resolving it ends the task.
    assert gate.resolve("req-1", True) is True
    assert await task is True


# ── AC-4: resume from checkpoint ──


def _seed_crashed_session(tmp_path: Path, sid: str) -> tuple[SessionStore, Path]:
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
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "todo_write", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "name": "todo_write", "content": "ok"},
        # Dangling call: round 3 dispatched but the process crashed mid-round.
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [
                {
                    "id": "c2",
                    "type": "function",
                    "function": {"name": "todo_write", "arguments": "{}"},
                }
            ],
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


async def test_resume_from_checkpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    sid = "crash-resume-1"
    store, sessions_root = _seed_crashed_session(tmp_path, sid)

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    cp_store = _local_store(tmp_path)
    cp_store.save(
        AgentCheckpoint(
            session_id=sid,
            turn_id="t-crash",
            round_idx=2,
            status="in_progress",
            pending_tool_calls=[
                {"id": "c2", "type": "function", "function": {"name": "todo_write", "arguments": "{}"}}
            ],
        )
    )

    # Route the manager's CheckpointStore (constructed internally) to tmp backend.
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(
        storage_factory, "_default_sessions_root", lambda: sessions_root
    )
    monkeypatch.setattr(
        storage_factory, "_default_config_dir", lambda: tmp_path / "cfg"
    )
    storage_factory.reset_storage_backend_for_testing()

    runner_calls: List[Dict[str, Any]] = {}

    async def _fake_runner(session_id: str, managed, checkpoint) -> bool:
        session = managed.studio_session
        # (1) context must be provider-legal: no dangling assistant tool_calls.
        tool_call_ids = set()
        answered_ids = set()
        for msg in session.agent_messages:
            if msg.get("role") == "assistant":
                for call in msg.get("tool_calls") or []:
                    tool_call_ids.add(str(call.get("id", "")))
            if msg.get("role") == "tool":
                answered_ids.add(str(msg.get("tool_call_id", "")))
        assert not (tool_call_ids - answered_ids), "dangling tool_calls survived sanitize"

        recording = _RecordingStore()
        llm = _TextOnlyLLM()
        runtime = AgentRuntime(llm, _ApproveGate(), checkpoint_store=recording)
        runner_calls["resume_start_round"] = max(1, int(checkpoint.round_idx) + 1)
        events: List[Dict[str, Any]] = []
        async for event in runtime.run_turn(
            RESUME_SYSTEM_HINT,
            session,
            resume_start_round=runner_calls["resume_start_round"],
            persist_user_message=False,
        ):
            events.append({"type": event.type, "data": event.data})
        # (2) the resumed turn starts at round 3.
        round_events = [e for e in events if e["type"] == EventType.ROUND_START.value]
        assert round_events and round_events[0]["data"]["round"] == 3
        assert events[-1]["type"] == EventType.FINAL.value
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_fake_runner)

    assert resumed == [sid]
    assert runner_calls["resume_start_round"] == 3
    # (3) checkpoint cleared and session back to idle.
    assert cp_store.load(sid) is None
    managed = manager.get(sid, touch=False)
    assert managed is not None
    assert managed.execution_state == "idle"


async def test_resume_skips_sessions_without_checkpoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    sid = "crash-no-checkpoint"
    store, sessions_root = _seed_crashed_session(tmp_path, sid)
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()

    called = False

    async def _runner(session_id, managed, checkpoint) -> bool:
        nonlocal called
        called = True
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_runner)
    assert resumed == []
    assert called is False


# ── AC-5: disabled by default ──


async def test_resume_disabled_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("AGX_RESUME_INTERRUPTED", raising=False)
    monkeypatch.delenv("AGX_HA_MODE", raising=False)
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)
    monkeypatch.setattr(ConfigManager, "get_value", classmethod(lambda cls, key: None))
    assert resume_interrupted_enabled() is False

    sid = "crash-disabled"
    store, sessions_root = _seed_crashed_session(tmp_path, sid)
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    called = False

    async def _runner(session_id, managed, checkpoint) -> bool:
        nonlocal called
        called = True
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_runner)
    assert resumed == []
    assert called is False
