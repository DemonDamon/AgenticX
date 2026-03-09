#!/usr/bin/env python3
"""Tests for Meta-Agent tool dispatchers."""

from __future__ import annotations

import asyncio
import json

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
