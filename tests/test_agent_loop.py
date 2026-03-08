#!/usr/bin/env python3
"""Tests for Studio agent loop termination behavior.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli import agent_loop
from agenticx.runtime import agent_runtime as runtime_module
from agenticx.cli.studio import StudioSession


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _SingleResponseLLM:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls = 0

    def invoke(self, *args, **kwargs):
        self.calls += 1
        return self._response

    def stream(self, *args, **kwargs):
        yield "final "
        yield "answer"


class _AlwaysToolCallLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *args, **kwargs):
        self.calls += 1
        return _FakeResponse(
            content="need tools",
            tool_calls=[
                {
                    "id": f"call-{self.calls}",
                    "type": "function",
                    "function": {
                        "name": "list_files",
                        "arguments": {"path": ".", "limit": 1},
                    },
                }
            ],
        )

    def stream(self, *args, **kwargs):
        yield ""


class _ToolThenFinalLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *args, **kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                content="先调用工具",
                tool_calls=[
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "list_files",
                            "arguments": {"path": ".", "limit": 1},
                        },
                    }
                ],
            )
        return _FakeResponse(content="最终答复", tool_calls=[])

    def stream(self, *args, **kwargs):
        yield "最终"
        yield "答复"


def test_run_agent_loop_finishes_without_tool_calls() -> None:
    session = StudioSession()
    llm = _SingleResponseLLM(_FakeResponse(content="final answer", tool_calls=[]))

    result = agent_loop.run_agent_loop(session, llm, "hello")

    assert result == "final answer"
    assert llm.calls == 1
    assert session.chat_history == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "final answer"},
    ]
    assert len(getattr(session, "agent_loop_history")) == 1


def test_run_agent_loop_stops_at_max_rounds(monkeypatch) -> None:
    session = StudioSession()
    llm = _AlwaysToolCallLLM()

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    result = agent_loop.run_agent_loop(session, llm, "keep going")

    assert "已达到最大工具调用轮数" in result
    assert llm.calls == agent_loop.MAX_TOOL_ROUNDS


def test_run_agent_loop_syncs_tool_messages_to_chat_history(monkeypatch) -> None:
    session = StudioSession()
    llm = _ToolThenFinalLLM()

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    result = agent_loop.run_agent_loop(session, llm, "请处理")

    assert result == "最终答复"
    assert session.chat_history[0] == {"role": "user", "content": "请处理"}
    assert any("工具调用" in item["content"] for item in session.chat_history if item["role"] == "assistant")
    assert any("tool-ok" in item["content"] for item in session.chat_history if item["role"] == "assistant")
    assert session.chat_history[-1] == {"role": "assistant", "content": "最终答复"}


def test_run_agent_loop_streams_text_when_no_tool_call() -> None:
    session = StudioSession()
    llm = _SingleResponseLLM(_FakeResponse(content="fallback answer", tool_calls=[]))

    result = agent_loop.run_agent_loop(session, llm, "hello")

    assert result == "final answer"
