#!/usr/bin/env python3
"""Tests for enhanced subagent spawn behavior."""

from __future__ import annotations

import asyncio

from agenticx.cli.studio import StudioSession
from agenticx.runtime.team_manager import AgentTeamManager, SpawnConfig


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content
        self.tool_calls = []


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("done")


async def _wait_until_done(manager: AgentTeamManager, agent_id: str, timeout: float = 2.0) -> None:
    for _ in range(int(timeout / 0.05)):
        state = manager.get_status(agent_id).get("subagent", {})
        if state.get("status") in {"completed", "failed", "cancelled"}:
            return
        await asyncio.sleep(0.05)


def test_spawn_depth_guard() -> None:
    session = StudioSession()
    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=session,
        spawn_config=SpawnConfig(max_spawn_depth=1, max_concurrent=4),
    )

    async def _run():
        first = await manager.spawn_subagent(name="a", role="worker", task="do")
        assert first.get("ok") is True
        child = await manager.spawn_subagent(
            name="b",
            role="worker",
            task="nested",
            parent_agent_id=str(first.get("agent_id")),
        )
        assert child.get("ok") is False
        assert child.get("error") == "max_spawn_depth_reached"
        await manager.shutdown()

    asyncio.run(_run())


def test_spawn_session_mode_keeps_session_and_announces() -> None:
    session = StudioSession()
    summaries = []

    async def _sink(summary, _ctx):
        summaries.append(summary)

    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=session,
        summary_sink=_sink,
        spawn_config=SpawnConfig(mode="session", max_concurrent=4),
    )

    async def _run():
        created = await manager.spawn_subagent(name="s", role="worker", task="do", mode="session")
        assert created.get("ok") is True
        agent_id = str(created.get("agent_id"))
        await _wait_until_done(manager, agent_id)
        assert agent_id in manager._agent_sessions
        sent = await manager.send_message_to_subagent(agent_id, "继续")
        assert sent.get("ok") is True
        await manager.shutdown()
        assert summaries

    asyncio.run(_run())


def test_run_mode_subagent_can_be_resumed_after_completion() -> None:
    """Run-mode subagents should accept follow-up messages after completion."""
    session = StudioSession()
    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=session,
        spawn_config=SpawnConfig(mode="run", max_concurrent=4),
    )

    async def _run():
        created = await manager.spawn_subagent(name="t", role="worker", task="initial")
        assert created.get("ok") is True
        agent_id = str(created.get("agent_id"))
        await _wait_until_done(manager, agent_id)

        ctx = manager._agents[agent_id]
        assert ctx.status.value in ("completed", "failed")
        assert agent_id not in manager._agent_sessions

        sent = await manager.send_message_to_subagent(agent_id, "follow up")
        assert sent.get("ok") is True, f"Expected ok, got: {sent}"
        assert ctx.status.value == "running"
        assert agent_id in manager._agent_sessions

        await _wait_until_done(manager, agent_id)
        await manager.shutdown()

    asyncio.run(_run())


def test_rebuild_agent_session_restores_context() -> None:
    """_rebuild_agent_session should carry over messages and artifacts from context."""
    session = StudioSession()
    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=session,
        spawn_config=SpawnConfig(mode="run", max_concurrent=4),
    )

    async def _run():
        created = await manager.spawn_subagent(name="r", role="worker", task="work")
        assert created.get("ok") is True
        agent_id = str(created.get("agent_id"))
        await _wait_until_done(manager, agent_id)

        ctx = manager._agents[agent_id]
        assert agent_id not in manager._agent_sessions

        rebuilt = manager._rebuild_agent_session(ctx)
        assert agent_id in manager._agent_sessions
        assert rebuilt.agent_messages == ctx.agent_messages
        await manager.shutdown()

    asyncio.run(_run())
