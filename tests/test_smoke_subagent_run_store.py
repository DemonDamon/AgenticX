#!/usr/bin/env python3
"""Smoke tests for SubAgentRunStore wiring.

Plan-Id: 2026-07-05-subagent-run-store-backend

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

import agenticx.runtime.subagent_runs.store as run_store_module
from agenticx.cli.studio import StudioSession
from agenticx.runtime import agent_runtime
from agenticx.runtime import meta_tools
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.team_manager import AgentTeamManager


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "ok"


class _ToolLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "need tool",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "list_files", "arguments": {"path": ".", "limit": 1}},
                    }
                ],
            )
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "ok"


class _FakeStudioSession:
    def __init__(self) -> None:
        self.workspace_dir = ""
        self.taskspaces: List[Dict[str, Any]] = []
        self.context_files: Dict[str, Any] = {}
        self.provider_name = "openai"
        self.model_name = "gpt-4o-mini"
        self.agent_messages: List[Dict[str, Any]] = []
        self.chat_history: List[Dict[str, Any]] = []
        self.artifacts: List[Any] = []


class _FakeAvatarManaged:
    def __init__(self) -> None:
        self.studio_session = _FakeStudioSession()
        self.session_id = "avatar-session-1"
        self.avatar_id = "avatar-1"
        self.avatar_name = "Coder"
        self.taskspaces: List[Dict[str, Any]] = []
        self.updated_at = 0.0
        self._delegation_info: Optional[Dict[str, Any]] = {"from_session": "meta-session-1"}

    def get_confirm_gate(self, _: str) -> Any:
        return object()

    def get_or_create_team(self, **_: Any) -> Any:
        return object()


class _FakeAvatarConfig:
    def __init__(self) -> None:
        self.id = "avatar-1"
        self.name = "Coder"
        self.role = "Engineer"
        self.system_prompt = ""
        self.default_provider = "openai"
        self.default_model = "gpt-4o-mini"
        self.workspace_dir = ""


class _FakeSessionManager:
    def persist(self, _: str) -> None:
        return None


class _DispatchSession(_FakeStudioSession):
    def __init__(self, session_manager: Any) -> None:
        super().__init__()
        self.scratchpad: Dict[str, Any] = {}
        self._session_manager = session_manager
        self._owner_session_id = "meta-session-1"


class _FakeCompletedRuntime:
    def __init__(self, *_: Any, **__: Any) -> None:
        pass

    async def run_turn(self, *_args: Any, **__: Any):  # type: ignore[no-untyped-def]
        avatar_session = _args[1]
        avatar_session.agent_messages.append(
            {
                "role": "tool",
                "name": "file_write",
                "content": "OK: wrote /tmp/subagent-run-store-delegate-report.md (10 chars)",
            }
        )
        yield RuntimeEvent(
            type=EventType.FINAL.value,
            data={"text": "delegation done"},
            agent_id="delegation-1",
        )


async def _wait_until(predicate, timeout: float = 3.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def test_smoke_subagent_run_store_cluster_and_cold_restart(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id="sess-alpha",
        )
        ids: List[str] = []
        for idx in range(3):
            result = await manager.spawn_subagent(
                name=f"Agent-{idx+1}",
                role="worker",
                task="生成计划",
                source_tool_call_id="tool-batch-1",
            )
            assert result["ok"] is True
            ids.append(result["agent_id"])
        await _wait_until(lambda: all(not manager._tasks.get(i) for i in ids))

        store = SubAgentRunStore("sess-alpha")
        runs = store.list_runs()
        assert len(runs) >= 3
        selected = [item for item in runs if item.run_id in ids]
        assert len(selected) == 3
        cluster_ids = {item.cluster_id for item in selected}
        assert len(cluster_ids) == 1
        badge_seqs = sorted(item.badge_seq for item in selected)
        assert badge_seqs == ["01", "02", "03"]

        # Cold restart simulation: rebuild store instance from disk.
        store_reloaded = SubAgentRunStore("sess-alpha")
        reloaded = store_reloaded.list_runs()
        assert {item.run_id for item in reloaded} >= set(ids)

    asyncio.run(_run())


def test_smoke_subagent_run_store_activity_timeline(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    from agenticx.runtime import agent_runtime as runtime_module

    async def _slow_dispatch(*_args, **_kwargs):
        await asyncio.sleep(0.01)
        return "ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _slow_dispatch)

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _ToolLLM(),
            base_session=StudioSession(),
            owner_session_id="sess-activity",
        )
        result = await manager.spawn_subagent(name="Tooler", role="worker", task="run tool once")
        assert result["ok"] is True
        run_id = result["agent_id"]
        await _wait_until(lambda: not manager._tasks.get(run_id))
        store = SubAgentRunStore("sess-activity")
        record = store.get_run(run_id)
        assert record is not None
        activity = store.read_activity(run_id)
        assert activity, "activity log should not be empty"
        kinds = {item.type for item in activity}
        assert "tool_call" in kinds
        assert "tool_result" in kinds

    asyncio.run(_run())


def test_smoke_subagent_run_store_append_fault_tolerant(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    from agenticx.runtime import agent_runtime as runtime_module

    async def _slow_dispatch(*_args, **_kwargs):
        await asyncio.sleep(0.01)
        return "ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _slow_dispatch)

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _ToolLLM(),
            base_session=StudioSession(),
            owner_session_id="sess-fault",
        )

        def _boom(*_args, **_kwargs):
            raise RuntimeError("append failed")

        monkeypatch.setattr(manager._run_store, "append_runtime_event", _boom)

        result = await manager.spawn_subagent(name="FaultSafe", role="worker", task="run tool once")
        assert result["ok"] is True
        run_id = result["agent_id"]
        await _wait_until(lambda: not manager._tasks.get(run_id))
        status = manager.get_status(run_id).get("subagent", {}).get("status")
        assert status in {"completed", "failed", "paused", "cancelled"}

    asyncio.run(_run())


def test_subagent_run_store_instances_share_owner_root_lock(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    first = SubAgentRunStore("shared-owner")
    second = SubAgentRunStore("shared-owner")

    assert first._lock is second._lock


def test_multi_instance_concurrent_open_preserves_all_runs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    stores = [
        SubAgentRunStore("concurrent-open-owner"),
        SubAgentRunStore("concurrent-open-owner"),
    ]
    locks_are_shared = stores[0]._lock is stores[1]._lock
    barrier = threading.Barrier(2)
    load_counts: dict[int, int] = {}
    counts_lock = threading.Lock()
    original_load_index = SubAgentRunStore._load_index

    def _synchronized_load_index(store: SubAgentRunStore) -> Dict[str, Any]:
        payload = original_load_index(store)
        thread_id = threading.get_ident()
        with counts_lock:
            count = load_counts.get(thread_id, 0)
            load_counts[thread_id] = count + 1
        if not locks_are_shared and count == 0:
            barrier.wait(timeout=5)
        return payload

    monkeypatch.setattr(
        SubAgentRunStore,
        "_load_index",
        _synchronized_load_index,
    )

    def _open(index: int) -> None:
        stores[index].open_run(
            run_id=f"concurrent-open-{index}",
            kind="delegate",
            name=f"Worker {index}",
            role="worker",
            task="concurrent task",
            status="pending",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(_open, range(2)))

    assert {
        record.run_id
        for record in SubAgentRunStore("concurrent-open-owner").list_runs()
    } == {"concurrent-open-0", "concurrent-open-1"}


def test_multi_instance_concurrent_cancel_and_close_preserve_history(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "concurrent-close-owner"
    run_id = "concurrent-close-run"
    SubAgentRunStore(owner_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Worker",
        role="worker",
        task="concurrent task",
        status="pending",
    )
    stores = [SubAgentRunStore(owner_id), SubAgentRunStore(owner_id)]
    locks_are_shared = stores[0]._lock is stores[1]._lock
    barrier = threading.Barrier(2)
    load_counts: dict[int, int] = {}
    counts_lock = threading.Lock()
    original_load_record = SubAgentRunStore._load_record_from_file

    def _synchronized_load_record(
        store: SubAgentRunStore,
        path: Path,
    ) -> Any:
        record = original_load_record(store, path)
        thread_id = threading.get_ident()
        with counts_lock:
            count = load_counts.get(thread_id, 0)
            load_counts[thread_id] = count + 1
        if not locks_are_shared and count == 0:
            barrier.wait(timeout=5)
        return record

    monkeypatch.setattr(
        SubAgentRunStore,
        "_load_record_from_file",
        _synchronized_load_record,
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                stores[0].update_status,
                run_id,
                status="cancelled",
            ),
            executor.submit(
                stores[1].close_run,
                run_id,
                status="completed",
            ),
        ]
        for future in futures:
            assert future.result() is not None

    record = SubAgentRunStore(owner_id).get_run(run_id)
    assert record is not None
    statuses = [item["status"] for item in record.status_history]
    assert "cancelled" in statuses
    assert "completed" in statuses


def test_subagent_run_store_json_writes_use_atomic_replace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    replaced_targets: list[Path] = []
    original_replace = os.replace

    def _recording_replace(source: Any, target: Any) -> None:
        replaced_targets.append(Path(target))
        original_replace(source, target)

    monkeypatch.setattr(os, "replace", _recording_replace)

    store = SubAgentRunStore("atomic-owner")
    store.open_run(
        run_id="atomic-run",
        kind="delegate",
        name="Worker",
        role="worker",
        task="atomic task",
        status="pending",
    )

    assert store.root / "atomic-run.json" in replaced_targets
    assert store.root / "index.json" in replaced_targets
    assert list(store.root.glob("*.tmp")) == []


def test_existing_corrupt_index_raises_read_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore("corrupt-index-owner")
    store.root.mkdir(parents=True, exist_ok=True)
    (store.root / "index.json").write_text("{broken", encoding="utf-8")

    with pytest.raises(run_store_module.SubAgentRunStoreReadError):
        store.list_runs()


def test_existing_corrupt_record_raises_read_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore("corrupt-record-owner")
    store.open_run(
        run_id="corrupt-record",
        kind="delegate",
        name="Worker",
        role="worker",
        task="test task",
        status="running",
    )
    (store.root / "corrupt-record.json").write_text("{broken", encoding="utf-8")

    with pytest.raises(run_store_module.SubAgentRunStoreReadError):
        store.list_runs()


def test_smoke_subagent_run_store_delegate_detail_ref(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(meta_tools, "ProviderResolver", types.SimpleNamespace(resolve=lambda **_: object()))

    import agenticx.runtime.agent_runtime as agent_runtime_module

    monkeypatch.setattr(agent_runtime_module, "AgentRuntime", _FakeCompletedRuntime)

    avatar_messages_path = (
        tmp_path / ".agenticx" / "sessions" / "avatar-session-1" / "messages.json"
    )
    avatar_messages_path.parent.mkdir(parents=True, exist_ok=True)
    avatar_messages_path.write_text(json.dumps([{"role": "assistant", "content": "hello"}]), encoding="utf-8")

    avatar_managed = _FakeAvatarManaged()
    avatar_config = _FakeAvatarConfig()
    session_manager = _FakeSessionManager()
    scratchpad: Dict[str, Any] = {}

    asyncio.run(
        meta_tools._run_delegation_in_avatar_session(
            avatar_managed=avatar_managed,
            avatar_config=avatar_config,
            task="写一份报告",
            meta_scratchpad=scratchpad,
            delegation_id="delegation-1",
            session_manager=session_manager,
            cancel_event=asyncio.Event(),
            meta_team_manager=None,
        )
    )

    store = SubAgentRunStore("meta-session-1")
    record = store.get_run("delegation-1")
    assert record is not None
    detail_path = str(record.detail_refs.get("avatar_messages_path", "")).strip()
    assert detail_path
    assert Path(detail_path).exists()


def test_delegate_dispatch_opens_pending_run_before_background_execution(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    gate = asyncio.Event()
    avatar_managed = _FakeAvatarManaged()
    session_manager = _FakeSessionManager()
    session = _DispatchSession(session_manager)
    avatar_config = _FakeAvatarConfig()

    class _FakeAvatarRegistry:
        def get_avatar(self, avatar_id: str) -> Any:
            return avatar_config if avatar_id == avatar_config.id else None

    async def _run_after_release(**kwargs: Any) -> None:
        await gate.wait()
        info = getattr(kwargs["avatar_managed"], "_delegation_info")
        SubAgentRunStore(info["from_session"]).open_run(
            run_id=kwargs["delegation_id"],
            kind="delegate",
            name=avatar_config.name,
            role=avatar_config.role,
            task=kwargs["task"],
            status="running",
            avatar_id=avatar_config.id,
            avatar_session_id=avatar_managed.session_id,
            source_tool_call_id=info["source_tool_call_id"],
        )

    monkeypatch.setattr(
        "agenticx.avatar.registry.AvatarRegistry",
        _FakeAvatarRegistry,
    )
    monkeypatch.setattr(
        meta_tools,
        "_find_running_avatar_delegation",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        meta_tools,
        "_find_or_create_avatar_session",
        lambda *_args, **_kwargs: avatar_managed,
    )
    monkeypatch.setattr(
        meta_tools,
        "_run_delegation_in_avatar_session",
        _run_after_release,
    )

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id="meta-session-1",
        )
        raw = await meta_tools.dispatch_meta_tool_async(
            "delegate_to_avatar",
            {
                "avatar_id": "avatar-1",
                "task": "write report",
                "__tool_call_id": "call-delegate-1",
            },
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        run_id = payload["delegation_id"]
        store = SubAgentRunStore("meta-session-1")
        pending = store.get_run(run_id)
        assert pending is not None
        assert pending.kind == "delegate"
        assert pending.status == "pending"
        assert pending.avatar_session_id == avatar_managed.session_id

        gate.set()
        await getattr(avatar_managed, "_delegation_task")
        running = store.get_run(run_id)
        assert running is not None
        assert [item["status"] for item in running.status_history] == [
            "pending",
            "running",
        ]

    asyncio.run(_run())


def test_smoke_subagent_cluster_anchor_updates_without_duplicate(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    session = StudioSession()
    setattr(session, "_session_id", "sess-anchor")

    store = SubAgentRunStore("sess-anchor")
    first = store.open_run(
        run_id="sa-anchor-1",
        kind="spawn",
        name="Analyst A",
        role="researcher",
        task="task A",
        status="running",
        source_tool_call_id="call-anchor-1",
        started_at=100,
    )
    changed = agent_runtime._append_subagent_cluster_anchor_if_needed(
        session,
        tool_name="spawn_subagent",
        tool_call_id="call-anchor-1",
        raw_result=json.dumps({"ok": True, "agent_id": "sa-anchor-1"}),
    )
    assert changed is True
    anchors = [
        row
        for row in session.chat_history
        if isinstance(row.get("metadata"), dict)
        and isinstance(row["metadata"].get("subagent_cluster"), dict)
    ]
    assert len(anchors) == 1
    anchor = anchors[0]["metadata"]["subagent_cluster"]
    assert anchor["cluster_id"] == first.cluster_id
    assert anchor["run_ids"] == ["sa-anchor-1"]
    assert session.agent_messages == []

    second = store.open_run(
        run_id="sa-anchor-2",
        kind="spawn",
        name="Analyst B",
        role="writer",
        task="task B",
        status="running",
        source_tool_call_id="call-anchor-2",
        started_at=101,
    )
    assert second.cluster_id == first.cluster_id
    changed = agent_runtime._append_subagent_cluster_anchor_if_needed(
        session,
        tool_name="spawn_subagent",
        tool_call_id="call-anchor-2",
        raw_result=json.dumps({"ok": True, "agent_id": "sa-anchor-2"}),
    )
    assert changed is True
    anchors = [
        row
        for row in session.chat_history
        if isinstance(row.get("metadata"), dict)
        and isinstance(row["metadata"].get("subagent_cluster"), dict)
    ]
    assert len(anchors) == 1
    anchor = anchors[0]["metadata"]["subagent_cluster"]
    assert anchor["run_ids"] == ["sa-anchor-1", "sa-anchor-2"]

    unchanged = agent_runtime._append_subagent_cluster_anchor_if_needed(
        session,
        tool_name="spawn_subagent",
        tool_call_id="call-anchor-2",
        raw_result=json.dumps({"ok": True, "agent_id": "sa-anchor-2"}),
    )
    assert unchanged is False
