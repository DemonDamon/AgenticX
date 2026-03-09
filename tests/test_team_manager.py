#!/usr/bin/env python3
"""Tests for AgentTeamManager lifecycle and scheduling."""

from __future__ import annotations

import asyncio
from typing import List

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import EventType, RuntimeEvent
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


async def _wait_until(predicate, timeout: float = 2.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def test_team_manager_spawn_and_collect_summary() -> None:
    emitted: List[RuntimeEvent] = []
    summaries: List[str] = []

    async def _emit(event: RuntimeEvent) -> None:
        emitted.append(event)

    async def _sink(summary: str, _context) -> None:
        summaries.append(summary)

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            event_emitter=_emit,
            summary_sink=_sink,
        )
        result = await manager.spawn_subagent(name="规划员", role="planner", task="生成计划")
        assert result["ok"] is True
        agent_id = result["agent_id"]
        await _wait_until(lambda: manager.get_status(agent_id)["subagent"]["status"] in {"completed", "failed"})
        status = manager.get_status(agent_id)["subagent"]
        assert status["status"] == "completed"
        assert summaries
        assert "已完成" in summaries[0]
        assert any(item.type == EventType.SUBAGENT_STARTED.value for item in emitted)
        assert any(item.type == EventType.SUBAGENT_COMPLETED.value for item in emitted)

    asyncio.run(_run())


def test_team_manager_concurrency_and_cancel(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _slow_dispatch(*_args, **_kwargs):
        await asyncio.sleep(0.2)
        return "ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _slow_dispatch)

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _ToolLLM(),
            base_session=StudioSession(),
            max_concurrent_subagents=1,
        )
        first = await manager.spawn_subagent(name="A", role="worker", task="task-a")
        assert first["ok"] is True
        second = await manager.spawn_subagent(name="B", role="worker", task="task-b")
        assert second["ok"] is False
        assert second["error"] == "max_concurrency_reached"
        cancelled = await manager.cancel_subagent(first["agent_id"])
        assert cancelled["ok"] is True

    asyncio.run(_run())


def test_team_manager_rejects_invalid_tool_allowlist() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        result = await manager.spawn_subagent(
            name="A",
            role="worker",
            task="task-a",
            tools=["not-exists-tool"],
        )
        assert result["ok"] is False
        assert result["error"] == "invalid_tools"

    asyncio.run(_run())


def test_team_manager_shutdown_now_clears_tasks(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _slow_dispatch(*_args, **_kwargs):
        await asyncio.sleep(0.3)
        return "ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _slow_dispatch)

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _ToolLLM(),
            base_session=StudioSession(),
        )
        result = await manager.spawn_subagent(name="A", role="worker", task="task-a")
        assert result["ok"] is True
        manager.shutdown_now()
        assert manager.get_status(result["agent_id"])["subagent"]["status"] in {"running", "cancelled"}

    asyncio.run(_run())
