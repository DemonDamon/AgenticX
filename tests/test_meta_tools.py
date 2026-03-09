#!/usr/bin/env python3
"""Tests for Meta-Agent tool dispatchers."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from agenticx.cli.studio import StudioSession
from agenticx.runtime.meta_tools import dispatch_meta_tool_async
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


def test_meta_tools_spawn_query_cancel_and_resource_check() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )

        spawn_raw = await dispatch_meta_tool_async(
            "spawn_subagent",
            {"name": "编码员", "role": "coder", "task": "写一个 demo"},
            team_manager=manager,
        )
        spawn_data = json.loads(spawn_raw)
        assert spawn_data["ok"] is True
        agent_id = spawn_data["agent_id"]

        query_raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {"agent_id": agent_id},
            team_manager=manager,
        )
        query_data = json.loads(query_raw)
        assert query_data["ok"] is True
        assert query_data["subagent"]["agent_id"] == agent_id

        resource_raw = await dispatch_meta_tool_async(
            "check_resources",
            {},
            team_manager=manager,
        )
        resource_data = json.loads(resource_raw)
        assert resource_data["ok"] is True
        assert "check" in resource_data

        cancel_raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": agent_id},
            team_manager=manager,
        )
        cancel_data = json.loads(cancel_raw)
        assert cancel_data["ok"] is True

    asyncio.run(_run())


def test_meta_tools_list_skills_and_mcps() -> None:
    async def _run() -> None:
        session = StudioSession()
        session.mcp_configs = {
            "github": SimpleNamespace(command="npx", args=["-y", "@modelcontextprotocol/server-github"])
        }
        session.connected_servers = {"github"}

        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
        )

        skills_raw = await dispatch_meta_tool_async(
            "list_skills",
            {},
            team_manager=manager,
            session=session,
        )
        skills_data = json.loads(skills_raw)
        assert skills_data["ok"] is True
        assert isinstance(skills_data.get("skills"), list)

        mcps_raw = await dispatch_meta_tool_async(
            "list_mcps",
            {},
            team_manager=manager,
            session=session,
        )
        mcps_data = json.loads(mcps_raw)
        assert mcps_data["ok"] is True
        assert mcps_data["count"] == 1
        assert mcps_data["connected_count"] == 1
        assert mcps_data["servers"][0]["name"] == "github"
        assert mcps_data["servers"][0]["connected"] is True
        assert "args" not in mcps_data["servers"][0]

    asyncio.run(_run())


def test_meta_tools_retry_subagent() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        spawn_raw = await dispatch_meta_tool_async(
            "spawn_subagent",
            {"name": "研究员", "role": "researcher", "task": "先执行一次"},
            team_manager=manager,
        )
        spawn_data = json.loads(spawn_raw)
        assert spawn_data["ok"] is True
        original_id = spawn_data["agent_id"]

        # Wait the quick sub-agent to leave running state.
        for _ in range(40):
            status = manager.get_status(original_id)
            if status.get("ok") and status.get("subagent", {}).get("status") != "running":
                break
            await asyncio.sleep(0.05)

        retry_raw = await dispatch_meta_tool_async(
            "retry_subagent",
            {"agent_id": original_id, "task": "基于失败信息重试"},
            team_manager=manager,
        )
        retry_data = json.loads(retry_raw)
        assert retry_data["ok"] is True
        assert retry_data["agent_id"] != original_id

    asyncio.run(_run())
