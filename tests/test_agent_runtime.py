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
        items.append({"type": event.type, "data": event.data})
    return items


def test_runtime_event_flow_tool_confirm_result_final(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_ToolThenFinalLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "do it"))

    types = [e["type"] for e in events]
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
    assert events[-1]["type"] == EventType.ERROR.value


def test_runtime_text_only_emits_tokens_then_final() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "hello"))
    types = [e["type"] for e in events]
    assert EventType.TOKEN.value in types
    assert events[-1]["type"] == EventType.FINAL.value
