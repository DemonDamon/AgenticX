#!/usr/bin/env python3
"""Smoke tests for SubAgentRunStore wiring.

Plan-Id: 2026-07-05-subagent-run-store-backend

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import types
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from agenticx.cli.studio import StudioSession
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
