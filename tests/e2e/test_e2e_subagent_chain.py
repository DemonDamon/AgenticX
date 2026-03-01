#!/usr/bin/env python3
"""E2E: handoff depth limit and PromptMode minimal behavior.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.core.agent import Agent
from agenticx.core.event import EventLog
from agenticx.core.handoff import HandoffLimitError
from agenticx.core.handoff import check_handoff_cycle
from agenticx.core.prompt import PromptManager
from agenticx.core.prompt import PromptMode
from agenticx.core.task import Task


def test_e2e_handoff_depth_limit_is_enforced():
    chain = ["root", "sub1"]
    with pytest.raises(HandoffLimitError):
        check_handoff_cycle(
            target_agent_id="sub2",
            handoff_chain=chain,
            max_chain_length=10,
            max_spawn_depth=2,
        )


def test_e2e_prompt_mode_minimal_for_subagent():
    event_log = EventLog(agent_id="a1", task_id="t1")
    agent = Agent(name="SubAgent", role="helper", goal="solve task")
    task = Task(description="Compute answer", expected_output="Result text")

    manager = PromptManager()
    prompt = manager.build_prompt(
        template_name="react",
        event_log=event_log,
        agent=agent,
        task=task,
        prompt_mode=PromptMode.MINIMAL,
    )

    assert "<minimal_context>" in prompt
    assert "<task>Compute answer</task>" in prompt
    assert "<goal>solve task</goal>" in prompt
