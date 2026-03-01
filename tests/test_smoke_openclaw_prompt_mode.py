#!/usr/bin/env python3
"""Smoke tests for prompt mode levels.

Author: Damon Li
"""

import pytest

from agenticx.core.agent import Agent
from agenticx.core.event import EventLog, TaskStartEvent
from agenticx.core.handoff import HandoffOutput, create_handoff_event
from agenticx.core.prompt import PromptManager, PromptMode
from agenticx.core.task import Task


def _sample_agent() -> Agent:
    return Agent(
        name="planner",
        role="assistant",
        goal="finish task",
        organization_id="org1",
    )


def _sample_task() -> Task:
    return Task(description="do work", expected_output="done")


class TestPromptMode:
    def test_full_vs_minimal_vs_none(self):
        manager = PromptManager()
        event_log = EventLog(agent_id="a1", task_id="t1")
        event_log.append(TaskStartEvent(task_description="start", agent_id="a1", task_id="t1"))
        agent = _sample_agent()
        task = _sample_task()

        full_prompt = manager.build_prompt("react", event_log, agent, task, prompt_mode=PromptMode.FULL)
        minimal_prompt = manager.build_prompt("react", event_log, agent, task, prompt_mode=PromptMode.MINIMAL)
        none_prompt = manager.build_prompt("react", event_log, agent, task, prompt_mode=PromptMode.NONE)

        assert len(full_prompt) > len(minimal_prompt)
        assert "<minimal_context>" in minimal_prompt
        assert "<execution_history>" not in none_prompt

    def test_invalid_mode_raises(self):
        manager = PromptManager()
        event_log = EventLog(agent_id="a1", task_id="t1")
        agent = _sample_agent()
        task = _sample_task()

        with pytest.raises(ValueError):
            manager.build_prompt("react", event_log, agent, task, prompt_mode="bad_mode")  # type: ignore[arg-type]

    def test_handoff_default_minimal_prompt_mode(self):
        handoff = HandoffOutput(target_agent_name="subagent")
        event = create_handoff_event(handoff, source_agent_id="main")
        assert event.data["prompt_mode"] == PromptMode.MINIMAL.value
