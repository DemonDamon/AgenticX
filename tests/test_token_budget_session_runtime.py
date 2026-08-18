#!/usr/bin/env python3
"""Runtime tests for durable session token-budget enforcement.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

from agenticx.cli.studio import StudioSession
from agenticx.runtime.agent_runtime import AgentRuntime, _serialize_scratchpad
from agenticx.runtime.events import EventType
from agenticx.runtime.token_budget import (
    TOKEN_BUDGET_SCRATCHPAD_KEY,
    TokenBudgetGuard,
)


class _UsageResponse:
    def __init__(self, text: str, *, input_tokens: int, output_tokens: int) -> None:
        self.content = text
        self.tool_calls: list[dict[str, Any]] = []
        self.token_usage = {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }


class _CountingUsageLLM:
    def __init__(self, *, input_tokens: int, output_tokens: int, text: str = "done") -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.text = text
        self.calls = 0

    def invoke(self, *_args: Any, **_kwargs: Any) -> _UsageResponse:
        self.calls += 1
        return _UsageResponse(
            self.text,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )


async def _collect(
    runtime: AgentRuntime,
    session: StudioSession,
    text: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    async for event in runtime.run_turn(text, session, tools=[]):
        rows.append({"type": event.type, "data": event.data})
    return rows


def _runtime(llm: Any, *, session_limit: int) -> AgentRuntime:
    runtime = AgentRuntime(llm=llm, confirm_gate=MagicMock())
    runtime.token_budget = TokenBudgetGuard(
        max_tokens_per_session=session_limit,
        max_tokens_per_turn=2_000_000,
    )
    return runtime


def test_crossing_session_limit_finishes_current_turn_then_blocks_next() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 900,
        "cumulative_output": 0,
        "warning_emitted": True,
    }

    crossing_llm = _CountingUsageLLM(input_tokens=120, output_tokens=20, text="completed result")
    crossing_runtime = _runtime(crossing_llm, session_limit=1_000)
    events = asyncio.run(_collect(crossing_runtime, session, "finish this"))

    assert crossing_llm.calls == 1
    assert events[-1]["type"] == EventType.FINAL.value
    assert events[-1]["data"]["text"] == "completed result"
    crossing_notices = [
        row
        for row in events
        if row["data"].get("detector") == "token_budget_session_reached"
    ]
    assert len(crossing_notices) == 1
    assert crossing_notices[0]["data"]["severity"] == "warning"
    assert crossing_notices[0]["data"]["block_next_turn"] is True
    assert "budget_exceeded" not in crossing_notices[0]["data"]
    assert session.chat_history[-1]["role"] == "assistant"
    assert session.chat_history[-1]["content"] == "completed result"
    assert session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY]["cumulative_input"] == 1_020
    assert session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY]["cumulative_output"] == 20

    blocked_llm = _CountingUsageLLM(input_tokens=1, output_tokens=1)
    blocked_runtime = _runtime(blocked_llm, session_limit=1_000)
    chat_before = list(session.chat_history)
    agent_before = list(session.agent_messages)
    blocked_events = asyncio.run(_collect(blocked_runtime, session, "one more request"))

    assert blocked_llm.calls == 0
    assert len(blocked_events) == 1
    assert blocked_events[0]["type"] == EventType.ERROR.value
    assert blocked_events[0]["data"]["detector"] == "token_budget"
    assert blocked_events[0]["data"]["budget_exceeded"] is True
    assert blocked_events[0]["data"]["blocked_before_model"] is True
    assert session.chat_history == chat_before
    assert session.agent_messages == agent_before


def test_raising_current_limit_unlocks_persisted_session() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 1_020,
        "cumulative_output": 20,
        "warning_emitted": True,
        "max_session": 1_000,
    }
    llm = _CountingUsageLLM(input_tokens=10, output_tokens=5, text="unlocked")
    runtime = _runtime(llm, session_limit=2_000)

    events = asyncio.run(_collect(runtime, session, "continue"))

    assert llm.calls == 1
    assert events[-1]["type"] == EventType.FINAL.value
    assert events[-1]["data"]["text"] == "unlocked"


def test_500k_warning_is_emitted_once_across_runtime_instances() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 499_900,
        "cumulative_output": 0,
        "warning_emitted": False,
    }

    first_events = asyncio.run(
        _collect(
            _runtime(_CountingUsageLLM(input_tokens=100, output_tokens=1), session_limit=1_000_000),
            session,
            "first",
        )
    )
    assert sum(
        row["data"].get("detector") == "token_budget_warning" for row in first_events
    ) == 1
    assert session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY]["warning_emitted"] is True

    second_events = asyncio.run(
        _collect(
            _runtime(_CountingUsageLLM(input_tokens=10, output_tokens=1), session_limit=1_000_000),
            session,
            "second",
        )
    )
    assert not any(
        row["data"].get("detector") == "token_budget_warning" for row in second_events
    )


def test_fixed_warning_is_not_skipped_when_usage_jumps_into_compress_range() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 499_900,
        "cumulative_output": 0,
        "warning_emitted": False,
    }

    events = asyncio.run(
        _collect(
            _runtime(
                _CountingUsageLLM(input_tokens=450_100, output_tokens=1),
                session_limit=1_000_000,
            ),
            session,
            "large paid turn",
        )
    )

    assert sum(
        row["data"].get("detector") == "token_budget_warning" for row in events
    ) == 1
    assert session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY]["warning_emitted"] is True


def test_internal_budget_state_is_not_serialized_for_the_model() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {"cumulative_input": 123}
    assert _serialize_scratchpad(session) == "(empty)"

    session.scratchpad["work_note"] = "visible"
    rendered = _serialize_scratchpad(session)
    assert "work_note: visible" in rendered
    assert TOKEN_BUDGET_SCRATCHPAD_KEY not in rendered
