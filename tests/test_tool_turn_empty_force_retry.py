#!/usr/bin/env python3
"""Tests for empty tool_calls + finish_reason=tool_calls force retry (FR-P0-B).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType

_THINK_OPEN = chr(60) + "think" + chr(62)
_THINK_CLOSE = chr(60) + "/think" + chr(62)


class _FakeResponse:
    def __init__(
        self,
        content: str,
        tool_calls,
        *,
        finish_reason: str = "",
        reasoning_content: str = "",
    ):
        self.content = content
        self.tool_calls = tool_calls
        self.finish_reason = finish_reason
        self.reasoning_content = reasoning_content


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _EmptyToolFinishThenReply:
    """Round 1: finish_reason=tool_calls but empty calls; round 2: real reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse("", [], finish_reason="tool_calls")
        return _FakeResponse("已完成说明", [], finish_reason="stop")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _AlwaysEmptyToolFinish:
    """Both rounds claim tool_calls but never emit usable calls."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        return _FakeResponse("", [], finish_reason="tool_calls")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _EmptyStopFinish:
    """Empty body with finish_reason=stop must NOT use P0-B force retry."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                _THINK_OPEN + "只思考" + _THINK_CLOSE,
                [],
                finish_reason="stop",
            )
        return _FakeResponse("最终回复", [], finish_reason="stop")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data})
    return items


def _final_text(events: List[Dict[str, Any]]) -> str:
    finals = [e for e in events if e["type"] == EventType.FINAL.value]
    return finals[-1]["data"].get("text", "") if finals else ""


def test_empty_tool_calls_with_tool_finish_retries_once_then_replies() -> None:
    llm = _EmptyToolFinishThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert llm.calls == 2
    assert _final_text(events) == "已完成说明"
    assert any(
        e["type"] == EventType.ROUND_END.value
        and (e.get("data") or {}).get("reason") == "empty_tool_calls_with_tool_finish"
        for e in events
    )


def test_empty_tool_calls_retry_budget_is_one() -> None:
    llm = _AlwaysEmptyToolFinish()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    # P0-B adds exactly one empty-tool-calls retry; the subsequent empty turn may
    # still consume the existing reason-only nudge once before terminal fallback.
    assert llm.calls == 3
    force_retries = [
        e
        for e in events
        if e["type"] == EventType.ROUND_END.value
        and (e.get("data") or {}).get("reason") == "empty_tool_calls_with_tool_finish"
    ]
    assert len(force_retries) == 1
    final = _final_text(events)
    assert final.strip()
    assert "未能生成完整的可见回复" in final or "没有给出总结" in final


def test_empty_stop_finish_does_not_use_empty_tool_calls_force_retry() -> None:
    llm = _EmptyStopFinish()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert not any(
        e["type"] == EventType.ROUND_END.value
        and (e.get("data") or {}).get("reason") == "empty_tool_calls_with_tool_finish"
        for e in events
    )
    assert _final_text(events) == "最终回复"
    assert llm.calls == 2
