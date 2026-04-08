#!/usr/bin/env python3
"""Smoke tests: send_message_to_subagent archived restore (module 5).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext, SubAgentStatus


@dataclass
class _FakeSession:
    agent_messages: list = field(default_factory=list)
    chat_history: list = field(default_factory=list)


@pytest.mark.asyncio
async def test_send_message_restores_from_archived() -> None:
    base = _FakeSession()
    ctx = SubAgentContext(
        agent_id="sa-test123",
        name="worker",
        role="r",
        task="t",
        status=SubAgentStatus.RUNNING,
    )
    tm = AgentTeamManager(
        llm_factory=lambda: object(),
        base_session=base,
        owner_session_id="sid",
    )
    tm._archived_agents["sa-test123"] = ctx
    tm._agent_sessions["sa-test123"] = base
    res = await tm.send_message_to_subagent("sa-test123", "continue please")
    assert res.get("ok") is True
    assert "sa-test123" in tm._agents
    assert "sa-test123" not in tm._archived_agents
    assert any("continue" in str(m.get("content", "")) for m in base.agent_messages)
