#!/usr/bin/env python3
"""Tests for AgentRuntime event stream behavior."""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ToolThenFinalLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "need tool",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "bash_exec", "arguments": {"command": "rm -rf /tmp/demo"}},
                    }
                ],
            )
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "done"


class _AlwaysToolLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "loop",
            [
                {
                    "id": "call-x",
                    "type": "function",
                    "function": {"name": "list_files", "arguments": {"path": ".", "limit": 1}},
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


class _TextOnlyLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("fallback", [])

    def stream(self, *_args, **_kwargs):
        yield "tok1"
        yield "tok2"


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
    return items


class _InvalidToolNameLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "bad tool call",
            [
                {
                    "id": "call-invalid",
                    "type": "function",
                    "function": {"name": None, "arguments": {}},
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


def test_runtime_event_flow_tool_confirm_result_final(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_ToolThenFinalLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "do it"))

    types = [e["type"] for e in events]
    assert all(e["agent_id"] == "meta" for e in events)
    assert EventType.ROUND_START.value in types
    assert EventType.TOOL_CALL.value in types
    assert EventType.TOOL_RESULT.value in types
    assert EventType.FINAL.value in types


def test_runtime_max_rounds_emits_error(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_AlwaysToolLLM(), _ApproveGate(), max_tool_rounds=2)
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "loop"))
    assert all(e["agent_id"] == "meta" for e in events)
    assert events[-1]["type"] == EventType.ERROR.value


def test_runtime_text_only_emits_tokens_then_final() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "hello"))
    types = [e["type"] for e in events]
    assert all(e["agent_id"] == "meta" for e in events)
    assert EventType.TOKEN.value in types
    assert events[-1]["type"] == EventType.FINAL.value


def test_runtime_should_stop_interrupts_generation() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    calls = {"n": 0}

    async def _should_stop() -> bool:
        calls["n"] += 1
        return calls["n"] >= 2

    async def _collect_interrupt() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("hello", StudioSession(), should_stop=_should_stop):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_interrupt())
    assert any(e["type"] == EventType.ROUND_START.value for e in events)
    assert events[-1]["type"] == EventType.ERROR.value
    assert events[-1]["agent_id"] == "meta"
    assert events[-1]["data"]["text"] == "已中断当前生成"
    assert not any(e["type"] == EventType.FINAL.value for e in events)


def test_runtime_accepts_custom_agent_id() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())

    async def _collect_custom() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("hello", StudioSession(), agent_id="sa-1"):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_custom())
    assert events
    assert all(e["agent_id"] == "sa-1" for e in events)


def test_runtime_rejects_tool_outside_allowlist(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    called = {"n": 0}

    async def _fake_dispatch(*_args, **_kwargs):
        called["n"] += 1
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_ToolThenFinalLLM(), _ApproveGate())
    allow_only_list_files = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    async def _collect_blocked() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("do it", StudioSession(), tools=allow_only_list_files):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_blocked())
    assert called["n"] == 0
    assert any("不在当前允许列表" in str(e["data"].get("text", "")) for e in events if e["type"] == EventType.ERROR.value)


def test_runtime_handles_invalid_tool_name_without_none_noise(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    called = {"n": 0}

    async def _fake_dispatch(*_args, **_kwargs):
        called["n"] += 1
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_InvalidToolNameLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "who is cole"))

    assert called["n"] == 0
    error_texts = [str(e["data"].get("text", "")) for e in events if e["type"] == EventType.ERROR.value]
    assert not any("Tool 'None'" in text or "工具 'None'" in text for text in error_texts)


def test_summarize_tool_calls_for_history_removes_runtime_ids() -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    tool_calls = [
        {
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "file_write",
                "arguments": "{\"path\":\"demo.py\",\"content\":\"print('ok')\"}",
            },
        }
    ]
    summary = runtime_module._summarize_tool_calls_for_history(tool_calls)
    assert summary == [
        {
            "name": "file_write",
            "arguments": {"path": "demo.py", "content": "print('ok')"},
        }
    ]
    assert "call_abc123" not in str(summary)
