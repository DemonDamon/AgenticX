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


def _roles_and_contents(history):
    """只取 role/content 比对。

    chat_history 里的 assistant 行现在还带一个 metadata（turn_terminal、各轮耗时、
    tool_schema_tokens_sent 等等），那是给 UI 和排查用的，值每次都不一样，不该进断言。
    """
    return [{"role": m["role"], "content": m["content"]} for m in history]


def test_run_agent_loop_finishes_without_tool_calls() -> None:
    session = StudioSession()
    llm = _SingleResponseLLM(_FakeResponse(content="final answer", tool_calls=[]))

    result = agent_loop.run_agent_loop(session, llm, "hello")

    assert result == "final answer"
    assert llm.calls == 1
    assert _roles_and_contents(session.chat_history) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "final answer"},
    ]
    assert len(getattr(session, "agent_loop_history")) == 1


def test_run_agent_loop_halts_when_tool_calls_stop_making_progress(monkeypatch) -> None:
    """反复调用同一个工具时，循环必须自己停下来并说明原因。

    这条用例原来叫 stops_at_max_rounds，断言 llm.calls == MAX_TOOL_ROUNDS(30) 且回复里
    有"已达到最大工具调用轮数"。现在停在第 12 轮：loop_detector 先一步认定"连续重复调用"
    ——比空烧 30 轮更好，但 MAX_TOOL_ROUNDS 那条文案在这种场景下已经到不了了
    （即便把参数改成每轮不同，另一个"未观察到进展"的探测器同样在 12 轮触发）。
    改成断言真正要守的东西：会停、停得比上限早、并且给出人能看懂的理由。
    """
    session = StudioSession()
    llm = _AlwaysToolCallLLM()

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    result = agent_loop.run_agent_loop(session, llm, "keep going")

    assert 0 < llm.calls < agent_loop.MAX_TOOL_ROUNDS
    assert "list_files" in result
    assert "重复调用" in result


def test_run_agent_loop_syncs_tool_messages_to_chat_history(monkeypatch) -> None:
    session = StudioSession()
    llm = _ToolThenFinalLLM()

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    result = agent_loop.run_agent_loop(session, llm, "请处理")

    assert result == "最终答复"
    assert _roles_and_contents(session.chat_history)[0] == {"role": "user", "content": "请处理"}

    # 工具结果现在是独立的一行 role="tool"（带 tool_call_id / tool_name / tool_status），
    # 不再拼成一句"工具调用…"塞进 assistant 的正文里。原断言按旧格式写的，早就失效了。
    tool_rows = [m for m in session.chat_history if m.get("role") == "tool"]
    assert len(tool_rows) == 1
    assert tool_rows[0]["content"] == "tool-ok"
    assert tool_rows[0]["tool_call_id"] == "call-1"
    assert tool_rows[0]["tool_name"] == "list_files"

    assert _roles_and_contents(session.chat_history)[-1] == {
        "role": "assistant",
        "content": "最终答复",
    }


def test_run_agent_loop_returns_invoke_content_when_no_tool_call() -> None:
    """没有工具调用时，直接用这一轮拿到的正文，不再为了取文本多打一次 stream()。

    原用例叫 streams_text_when_no_tool_call，构造的响应正文是 "fallback answer"，
    却断言结果等于 "final answer"（也就是 _SingleResponseLLM.stream() 吐的那两段）。
    现在不会再走一次 stream 了，所以拿到的就是 invoke 的正文。
    """
    session = StudioSession()
    llm = _SingleResponseLLM(_FakeResponse(content="fallback answer", tool_calls=[]))

    result = agent_loop.run_agent_loop(session, llm, "hello")

    assert result == "fallback answer"
    assert llm.calls == 1
