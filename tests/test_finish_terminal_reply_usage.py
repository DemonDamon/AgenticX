#!/usr/bin/env python3
"""Tests that terminal assistant rows persist turn usage and model.

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime


@pytest.mark.asyncio
async def test_finish_terminal_reply_writes_usage_and_model() -> None:
    runtime = AgentRuntime(llm=MagicMock(), confirm_gate=MagicMock())
    session = StudioSession(provider_name="moonshot", model_name="kimi-k2.6")
    session.chat_history = [{"role": "user", "content": "hi"}]

    event = await runtime._finish_terminal_reply(
        session,
        clean_body="hello",
        usage_metadata={
            "input_tokens": 1200,
            "output_tokens": 340,
            "cached_tokens": 80,
            "reasoning_tokens": 0,
            "total_tokens": 1540,
        },
        terminal_reason="model_final",
        agent_id="meta",
        is_system_trigger=False,
    )

    hist = session.chat_history[-1]
    assert hist["role"] == "assistant"
    assert hist["provider"] == "moonshot"
    assert hist["model"] == "kimi-k2.6"
    assert hist["model_selection"] == "manual"
    assert hist["usage"]["input_tokens"] == 1200
    assert hist["usage"]["output_tokens"] == 340
    assert hist["usage"]["cached_tokens"] == 80
    assert hist["usage"]["total_tokens"] == 1540
    assert event.data["usage_metadata"]["total_tokens"] == 1540


@pytest.mark.asyncio
async def test_finish_terminal_reply_omits_zero_usage() -> None:
    runtime = AgentRuntime(llm=MagicMock(), confirm_gate=MagicMock())
    session = StudioSession(provider_name="zhipu", model_name="glm-5")
    session.chat_history = [{"role": "user", "content": "hi"}]

    await runtime._finish_terminal_reply(
        session,
        clean_body="hello",
        usage_metadata={
            "input_tokens": 0,
            "output_tokens": 0,
            "cached_tokens": 0,
            "reasoning_tokens": 0,
            "total_tokens": 0,
        },
        terminal_reason="model_final",
        agent_id="meta",
        is_system_trigger=False,
    )

    hist = session.chat_history[-1]
    assert hist["provider"] == "zhipu"
    assert hist["model"] == "glm-5"
    assert "usage" not in hist
