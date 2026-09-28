#!/usr/bin/env python3
"""Mid-turn reasoning must land in chat_history for interleaved UI.

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
        reasoning_content: str = "",
    ):
        self.content = content
        self.tool_calls = tool_calls
        self.reasoning_content = reasoning_content
        self.finish_reason = ""


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _ThinkThenToolThenReply:
    """Round 1: think + tool_search. Round 2: final answer."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                _THINK_OPEN + "Need get_trace first" + _THINK_CLOSE,
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "list_files", "arguments": {"path": "."}},
                    }
                ],
            )
        return _FakeResponse("目录已列出。", [])

    def stream(self, *_args, **_kwargs):
        if self.calls == 1:
            yield _THINK_OPEN + "Need get_trace first" + _THINK_CLOSE
        else:
            yield "目录已列出。"


class _ThinkPrefaceToolThenReply:
    """Round 1: think + visible preface + tool. Round 2: final."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                _THINK_OPEN
                + "Schemas ready"
                + _THINK_CLOSE
                + "四个工具已就绪，并行拉取数据。",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "list_files", "arguments": {"path": "."}},
                    }
                ],
            )
        return _FakeResponse("结论：完成。", [])

    def stream(self, *_args, **_kwargs):
        if self.calls == 1:
            yield (
                _THINK_OPEN
                + "Schemas ready"
                + _THINK_CLOSE
                + "四个工具已就绪，并行拉取数据。"
            )
        else:
            yield "结论：完成。"


async def _run(runtime: AgentRuntime, session: StudioSession, text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data})
    return items


def test_reasoning_only_tool_round_persists_reasoning_in_chat_history(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ThinkThenToolThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_run(runtime, session, "查一下"))
    assert any(e["type"] == EventType.FINAL.value for e in events)

    mid = [
        row
        for row in session.chat_history
        if row.get("role") == "assistant"
        and (row.get("metadata") or {}).get("turn_terminal") is False
    ]
    assert mid, "expected a mid-turn assistant row before tools"
    assert mid[0].get("reasoning", "").strip() == "Need get_trace first"
    assert not str(mid[0].get("content") or "").strip()
    assert _THINK_OPEN not in str(mid[0].get("reasoning") or "")


def test_preface_plus_reasoning_tool_round_persists_both(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ThinkPrefaceToolThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    asyncio.run(_run(runtime, session, "并行拉取"))

    mid = [
        row
        for row in session.chat_history
        if row.get("role") == "assistant"
        and (row.get("metadata") or {}).get("turn_terminal") is False
    ]
    assert len(mid) >= 1
    assert "四个工具已就绪" in str(mid[0].get("content") or "")
    assert mid[0].get("reasoning", "").strip() == "Schemas ready"
