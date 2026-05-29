#!/usr/bin/env python3
"""Smoke tests for canonical async FC ReActAgent (embeddable primitive v2).

Run:
    pytest -q tests/test_smoke_agx_fc_react_agent.py

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Union

import pytest

from agenticx.agents import (
    FinalEvent,
    ReActAgent,
    ReActResult,
    ToolCallEvent,
    ToolResultEvent,
)
from agenticx.agents.agent_events import AgentEvent
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage
from agenticx.tools.base import BaseTool


# --------------------------------------------------------------------------- #
# Test doubles
# --------------------------------------------------------------------------- #


class MockFCProvider(BaseLLMProvider):
    """Scripted async FC provider returning pre-built LLMResponse objects."""

    model: str = "mock-fc"

    def __init__(self, responses: List[LLMResponse], **data: Any):
        super().__init__(**data)
        object.__setattr__(self, "_responses", list(responses))
        object.__setattr__(self, "_calls", 0)

    @property
    def call_count(self) -> int:
        return object.__getattribute__(self, "_calls")

    def _pop(self) -> LLMResponse:
        idx = object.__getattribute__(self, "_calls")
        responses = object.__getattribute__(self, "_responses")
        object.__setattr__(self, "_calls", idx + 1)
        if idx < len(responses):
            return responses[idx]
        return LLMResponse(
            id="fallback",
            model_name=self.model,
            created=0,
            content="fallback answer",
            choices=[LLMChoice(index=0, content="fallback answer")],
            token_usage=TokenUsage(),
        )

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict[str, Any]]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        return self._pop()

    def invoke(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError("use ainvoke in tests")

    def stream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    async def astream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError


def _tc(name: str, args: dict, tc_id: str = "tc1") -> Dict[str, Any]:
    return {
        "id": tc_id,
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(args),
        },
    }


class EchoTool(BaseTool):
    def __init__(self):
        super().__init__(name="echo", description="Echo text.")
        self.calls: List[str] = []

    def _run(self, **kwargs):
        text = kwargs.get("text", "")
        self.calls.append(text)
        return f"echoed:{text}"


class BoomTool(BaseTool):
    def __init__(self):
        super().__init__(name="boom", description="Always fails.")

    def _run(self, **kwargs):
        raise RuntimeError("boom")


def _agent(llm: MockFCProvider, tools: Optional[List[BaseTool]] = None) -> ReActAgent:
    return ReActAgent(
        llm=llm,
        tools=tools or [EchoTool()],
        system_prompt="Test agent.",
        max_iterations=5,
    )


# --------------------------------------------------------------------------- #
# AC-1 happy path
# --------------------------------------------------------------------------- #


def test_fc_happy_path_tool_then_answer():
    llm = MockFCProvider(
        [
            LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="",
                choices=[],
                token_usage=TokenUsage(),
                tool_calls=[_tc("echo", {"text": "hello"}, "call_1")],
            ),
            LLMResponse(
                id="2",
                model_name="mock",
                created=0,
                content="The echo said hello.",
                choices=[LLMChoice(index=0, content="The echo said hello.")],
                token_usage=TokenUsage(),
                tool_calls=None,
            ),
        ]
    )
    echo = EchoTool()
    agent = _agent(llm, [echo])

    async def _run():
        return await agent.arun("please echo hello")

    result = asyncio.run(_run())
    assert isinstance(result, ReActResult)
    assert result.success is True
    assert "hello" in str(result.output).lower() or echo.calls == ["hello"]
    assert echo.calls == ["hello"]
    assert llm.call_count >= 2
    assert any(m.get("role") == "tool" for m in result.messages)


# --------------------------------------------------------------------------- #
# AC-2 running loop
# --------------------------------------------------------------------------- #


def test_fc_arun_inside_running_loop():
    llm = MockFCProvider(
        [
            LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="ok",
                choices=[LLMChoice(index=0, content="ok")],
                token_usage=TokenUsage(),
            ),
        ]
    )
    agent = _agent(llm, [])

    async def _inner():
        r = await agent.arun("hi")
        assert r.success
        events = []
        async for ev in agent.astream("hi2"):
            events.append(ev)
        assert events[-1].type == "final"

    asyncio.run(_inner())


# --------------------------------------------------------------------------- #
# AC-3 tool error path
# --------------------------------------------------------------------------- #


def test_fc_tool_error_then_continue():
    llm = MockFCProvider(
        [
            LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="",
                choices=[],
                token_usage=TokenUsage(),
                tool_calls=[_tc("boom", {}, "c1")],
            ),
            LLMResponse(
                id="2",
                model_name="mock",
                created=0,
                content="recovered",
                choices=[LLMChoice(index=0, content="recovered")],
                token_usage=TokenUsage(),
            ),
        ]
    )
    agent = _agent(llm, [BoomTool()])

    async def _run():
        return await agent.arun("trigger boom")

    result = asyncio.run(_run())
    assert result.success is True
    assert result.output == "recovered"
    tool_msgs = [m for m in result.messages if m.get("role") == "tool"]
    assert tool_msgs and "ERROR" in tool_msgs[0].get("content", "")


# --------------------------------------------------------------------------- #
# AC-4 import purity
# --------------------------------------------------------------------------- #


def test_fc_import_no_studio_runtime():
    heavy = [
        "agenticx.studio",
        "agenticx.cli.studio",
        "agenticx.cli.agent_tools",
        "agenticx.cli.studio_mcp",
        "agenticx.cli.studio_skill",
        "agenticx.runtime.agent_runtime",
    ]
    code = (
        "import sys; import agenticx.agents.react_agent_async as r; "
        f"heavy={heavy!r}; "
        "pulled=[m for m in heavy if m in sys.modules]; "
        "assert not pulled, pulled; "
        "assert hasattr(r, 'ReActAgent')"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


# --------------------------------------------------------------------------- #
# AC-5 parallel tool calls
# --------------------------------------------------------------------------- #


def test_fc_parallel_tool_calls():
    llm = MockFCProvider(
        [
            LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="",
                choices=[],
                token_usage=TokenUsage(),
                tool_calls=[
                    _tc("echo", {"text": "a"}, "c1"),
                    _tc("echo", {"text": "b"}, "c2"),
                ],
            ),
            LLMResponse(
                id="2",
                model_name="mock",
                created=0,
                content="done",
                choices=[LLMChoice(index=0, content="done")],
                token_usage=TokenUsage(),
            ),
        ]
    )
    echo = EchoTool()
    agent = _agent(llm, [echo])

    async def _run():
        return await agent.arun("parallel")

    asyncio.run(_run())
    assert sorted(echo.calls) == ["a", "b"]


# --------------------------------------------------------------------------- #
# AC-6 astream vs arun consistency
# --------------------------------------------------------------------------- #


def test_fc_astream_final_matches_arun():
    responses = [
        LLMResponse(
            id="1",
            model_name="mock",
            created=0,
            content="",
            choices=[],
            token_usage=TokenUsage(),
            tool_calls=[_tc("echo", {"text": "x"}, "c1")],
        ),
        LLMResponse(
            id="2",
            model_name="mock",
            created=0,
            content="final-answer",
            choices=[LLMChoice(index=0, content="final-answer")],
            token_usage=TokenUsage(),
        ),
    ]
    llm_run = MockFCProvider(list(responses))
    llm_stream = MockFCProvider(list(responses))
    echo1, echo2 = EchoTool(), EchoTool()

    async def _run():
        r1 = await _agent(llm_run, [echo1]).arun("q")
        events: List[AgentEvent] = []
        async for ev in _agent(llm_stream, [echo2]).astream("q"):
            events.append(ev)
        assert events[-1].type == "final"
        final = events[-1]
        assert isinstance(final, FinalEvent)
        assert r1.output == final.output
        assert r1.success == final.success

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# AC-7 multi-turn history
# --------------------------------------------------------------------------- #


def test_fc_multi_turn_history():
    class HistoryAwareMock(MockFCProvider):
        async def ainvoke(self, prompt, tools=None, **kwargs):
            msgs = prompt if isinstance(prompt, list) else []
            blob = json.dumps(msgs, ensure_ascii=False)
            if "SECRET=99" in blob and "what was the secret" in blob.lower():
                return LLMResponse(
                    id="2",
                    model_name="mock",
                    created=0,
                    content="the secret was 99",
                    choices=[LLMChoice(index=0, content="the secret was 99")],
                    token_usage=TokenUsage(),
                )
            return LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="SECRET=99 noted",
                choices=[LLMChoice(index=0, content="SECRET=99 noted")],
                token_usage=TokenUsage(),
            )

    agent = ReActAgent(llm=HistoryAwareMock([]), tools=[], system_prompt="mem")

    async def _run():
        r1 = await agent.arun("remember SECRET=99")
        r2 = await agent.arun("what was the secret?", history=r1.messages)
        return r2

    r2 = asyncio.run(_run())
    assert "99" in str(r2.output)


# --------------------------------------------------------------------------- #
# AC-8 cancellation
# --------------------------------------------------------------------------- #


def test_fc_astream_cancellation():
    class SlowMock(MockFCProvider):
        async def ainvoke(self, prompt, tools=None, **kwargs):
            await asyncio.sleep(0.3)
            return self._pop()

    slow_responses = [
        LLMResponse(
            id=str(i),
            model_name="mock",
            created=0,
            content="",
            choices=[],
            token_usage=TokenUsage(),
            tool_calls=[_tc("echo", {"text": str(i)}, f"c{i}")],
        )
        for i in range(20)
    ] + [
        LLMResponse(
            id="end",
            model_name="mock",
            created=0,
            content="end",
            choices=[LLMChoice(index=0, content="end")],
            token_usage=TokenUsage(),
        )
    ]
    agent = _agent(SlowMock(slow_responses), [EchoTool()])

    async def _run():
        task = asyncio.create_task(_consume(agent))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    async def _consume(ag: ReActAgent):
        async for _ in ag.astream("loop"):
            await asyncio.sleep(0)

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# AC-9 optional real provider
# --------------------------------------------------------------------------- #


@pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY") and not os.environ.get("AGX_TEST_LLM_KEY"),
    reason="no OPENAI_API_KEY or AGX_TEST_LLM_KEY for live FC test",
)
def test_fc_live_openai_compatible_optional():
    """Optional e2e: real provider + echo tool (AC-9)."""
    from agenticx.llms.litellm_provider import LiteLLMProvider

    class AddTool(BaseTool):
        def __init__(self):
            super().__init__(name="add", description="Add two integers.")

        def _run(self, a: int = 0, b: int = 0):
            return str(a + b)

    model = os.environ.get("AGX_TEST_LLM_MODEL", "gpt-4o-mini")
    llm = LiteLLMProvider(
        model=model,
        api_key=os.environ.get("AGX_TEST_LLM_KEY") or os.environ.get("OPENAI_API_KEY"),
    )
    agent = ReActAgent(
        llm=llm,
        tools=[AddTool()],
        system_prompt="Use the add tool when asked to sum numbers, then answer briefly.",
        max_iterations=4,
    )

    async def _run():
        return await agent.arun("What is 17 + 25? Use the add tool.")

    result = asyncio.run(_run())
    assert result.success
    assert "42" in str(result.output)


def test_run_raises_inside_loop():
    llm = MockFCProvider(
        [
            LLMResponse(
                id="1",
                model_name="mock",
                created=0,
                content="ok",
                choices=[LLMChoice(index=0, content="ok")],
                token_usage=TokenUsage(),
            ),
        ]
    )
    agent = _agent(llm, [])

    async def _run():
        await agent.arun("x")
        with pytest.raises(RuntimeError, match="event loop"):
            agent.run("y")

    asyncio.run(_run())
