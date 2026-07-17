#!/usr/bin/env python3
"""Tests for tool-turn premature end fix: reasoning-only empty turn nudge retry.

Covers FR-2 (reasoning-only detection + nudge retry), FR-2a (补救 logic uses
visible_text), FR-4 (content回退改为 _clean_body, no < Mattis> leak), and the
stream-fallback dict-chunk text-key fix.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType

_THINK_OPEN = chr(60) + "think" + chr(62)
_THINK_CLOSE = chr(60) + "/think" + chr(62)


class _FakeResponse:
    def __init__(self, content: str, tool_calls, reasoning_content: str = ""):
        self.content = content
        self.tool_calls = tool_calls
        self.reasoning_content = reasoning_content


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _ReasoningInContentThenReply:
    """1st invoke: reasoning-only in content. 2nd invoke: real reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(_THINK_OPEN + "需要继续" + _THINK_CLOSE, [])
        return _FakeResponse("已查到价格表", [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "需要继续" + _THINK_CLOSE


class _ReasoningInSeparateFieldThenReply:
    """1st invoke: empty content + reasoning_content. 2nd invoke: real reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse("", [], reasoning_content="需要继续")
        return _FakeResponse("已查到价格表", [])

    def stream(self, *_args, **_kwargs):
        yield {"type": "content", "text": _THINK_OPEN + "需要继续" + _THINK_CLOSE}


class _AlwaysReasoningOnly:
    """Every invoke returns reasoning-only; nudge exhausts, turn ends empty."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(_THINK_OPEN + "只会思考" + _THINK_CLOSE, [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "只会思考" + _THINK_CLOSE


class _NormalReasoningPlusBody:
    """reasoning + body in one turn; must NOT trigger nudge."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        return _FakeResponse(_THINK_OPEN + "思考" + _THINK_CLOSE + "这是回复", [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "思考" + _THINK_CLOSE + "这是回复"


class _ToolThenReasoningOnlyThenStillReasoning:
    """1st: tool_call. 2nd: reasoning-only (nudge). 3rd: still reasoning-only (exhaust)."""

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
                        "function": {"name": "list_files", "arguments": {"path": "."}},
                    }
                ],
            )
        return _FakeResponse(_THINK_OPEN + "还在思考" + _THINK_CLOSE, [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "还在思考" + _THINK_CLOSE


class _TextOnlyDictStream:
    """stream yields dict chunks with text key; verifies stream-fallback tok fix."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("", [])

    def stream(self, *_args, **_kwargs):
        yield {"type": "content", "text": "hello "}
        yield {"type": "content", "text": "world"}


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data})
    return items


def _final_text(events: List[Dict[str, Any]]) -> str:
    finals = [e for e in events if e["type"] == EventType.FINAL.value]
    return finals[-1]["data"].get("text", "") if finals else ""


def test_reasoning_in_content_triggers_nudge_then_real_reply() -> None:
    """FR-2: reasoning-only in content triggers nudge; 2nd invoke gives real reply."""
    llm = _ReasoningInContentThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert llm.calls == 2, "nudge should trigger a 2nd invoke"
    assert _final_text(events) == "已查到价格表"
    last = session.chat_history[-1]
    assert last["role"] == "assistant"
    assert last["content"] == "已查到价格表"
    assert _THINK_OPEN not in last["content"], "content must not leak < Mattis>"


def test_reasoning_in_separate_field_triggers_nudge_then_real_reply() -> None:
    """FR-2: reasoning in reasoning_content (empty content) also triggers nudge."""
    llm = _ReasoningInSeparateFieldThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert llm.calls == 2
    assert _final_text(events) == "已查到价格表"
    last = session.chat_history[-1]
    assert last["content"] == "已查到价格表"
    assert _THINK_OPEN not in last["content"]


def test_reasoning_only_exhausts_nudge_emits_visible_retry_fallback() -> None:
    """After one nudge, reasoning-only turns emit a non-empty neutral fallback."""
    llm = _AlwaysReasoningOnly()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    final = _final_text(events)
    assert final.strip(), "FINAL text must be non-empty after nudge exhausts"
    assert "未能生成完整的可见回复" in final
    last = session.chat_history[-1]
    assert last["role"] == "assistant"
    assert last["content"] == final
    assert last.get("metadata", {}).get("turn_terminal") is True
    assert _THINK_OPEN not in last["content"]


def test_normal_reasoning_plus_body_does_not_trigger_nudge() -> None:
    """NFR-1: normal reasoning+body turn must not trigger nudge (single invoke)."""
    llm = _NormalReasoningPlusBody()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "hi"))
    assert llm.calls == 1, "normal turn must not trigger nudge"
    assert _final_text(events) == "这是回复"
    last = session.chat_history[-1]
    assert last["content"] == "这是回复"
    assert _THINK_OPEN not in last["content"]


def test_reasoning_only_after_tool_triggers_fallback_placeholder(monkeypatch) -> None:
    """FR-2a + AC-6: tool executed, then reasoning-only, nudge exhausts -> 补救 placeholder.

    Without the visible_text fix, the Mattis in final_text would mask the补救
    trigger (final_text.strip() non-empty) and the turn would end with Mattis
    pollution instead of the placeholder.
    """
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenReasoningOnlyThenStillReasoning()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "do it"))
    # nudge fired on round 2 (reasoning-only after tool), exhausted on round 3.
    assert llm.calls == 3
    final = _final_text(events)
    # Neutral tool-turn fallback (no "已完成工具调用", no replay hint).
    assert "工具执行已经结束" in final, f"tool-turn fallback expected, got {final!r}"
    assert "已完成工具调用" not in final
    assert _THINK_OPEN not in final, "FINAL text must not leak Mattis"
    last = session.chat_history[-1]
    assert _THINK_OPEN not in last["content"], "chat_history content must not leak Mattis"
    assert last.get("metadata", {}).get("terminal_reason") == "tool_turn_empty_fallback"


def test_stream_fallback_dict_chunk_text_key_parsed() -> None:
    """FR (stream-fallback fix): dict chunks with 'text' key must be accumulated."""
    llm = _TextOnlyDictStream()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "hi"))
    # Without the fix, chunk.get("content", "") returned "" for dict-with-text-key,
    # leaving streamed_text empty. With the fix, "hello world" is accumulated.
    assert _final_text(events) == "hello world"
    last = session.chat_history[-1]
    assert last["content"] == "hello world"


def test_interleaved_duplicate_reasoning_is_stripped_clean() -> None:
    """Phase 2 regression: case B interleaved-duplicate reasoning must be stripped.

    Case B (e3033b24) saw the upstream provider echo reasoning chunks with
    character-level interleaving ("用户已经看到了我上一轮的 用户已经看到了我上一轮的...").
    _split_reasoning_and_body must still strip the < Mattis> block so content
    stays clean, and nudge retry must fire so the model gives a real reply.
    """
    from agenticx.runtime.agent_runtime import _split_reasoning_and_body

    interleaved = (
        _THINK_OPEN
        + "用户已经看到了我上一轮的 用户已经看到了我上一轮的完整代码示例。"
        + "系统提示说我之前的工具调用（list完整代码示例。系统提示说我之前的工具调用（list_files）已经完成"
        + _THINK_CLOSE
    )
    reasoning, body = _split_reasoning_and_body(interleaved)
    assert body == "", "interleaved reasoning must strip to empty body"
    assert reasoning, "reasoning text must be captured"
    assert _THINK_OPEN not in body

