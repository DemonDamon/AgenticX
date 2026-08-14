#!/usr/bin/env python3
"""Smoke tests for overflow compact + same-turn retry (G-003).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _FakeResponse:
    def __init__(self, content: str = "done", tool_calls: list | None = None) -> None:
        self.content = content
        self.tool_calls = tool_calls or []
        self.finish_reason = "stop"
        self.reasoning_content = ""


class _OverflowThenOk:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("ContextWindowExceededError: maximum context length is 8192 tokens")
        return _FakeResponse("全部完成")


class _AlwaysOverflow:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        raise RuntimeError("ContextWindowExceededError: maximum context length is 8192 tokens")


class _RecordingCompactor:
    def __init__(self, *, progress: bool) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.progress = progress

    async def maybe_compact(self, messages, *, force: bool = False, model: str = ""):
        copied = [dict(m) for m in messages if isinstance(m, dict)]
        self.calls.append({"force": force, "model": model, "n": len(copied)})
        if not self.progress or len(copied) <= 2:
            return copied, False, "", 0, ""
        shortened = copied[: max(2, len(copied) - 1)]
        return shortened, True, "compacted", 1, ""

    def micro_compact_tool_result(self, tool_name: str, raw_result: str) -> str:
        return raw_result


def _seed_history(session: StudioSession, n: int = 8) -> None:
    session.agent_messages = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg-{i}"}
        for i in range(n)
    ]


def _collect(runtime: AgentRuntime, session: StudioSession, text: str = "continue") -> List[Dict[str, Any]]:
    async def _run() -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        async for event in runtime.run_turn(text, session):
            events.append({"type": event.type, "data": event.data})
        return events

    return asyncio.run(_run())


def test_overflow_compact_retry_then_final(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_OVERFLOW_RETRY", raising=False)
    llm = _OverflowThenOk()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=4)
    runtime.compactor = _RecordingCompactor(progress=True)
    session = StudioSession()
    _seed_history(session)
    events = _collect(runtime, session)
    assert any(c["force"] is True for c in runtime.compactor.calls)
    assert events[-1]["type"] == EventType.FINAL.value
    assert runtime._overflow_retries_this_turn == 0


def test_overflow_no_progress_does_not_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_OVERFLOW_RETRY", raising=False)
    llm = _AlwaysOverflow()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=6)
    runtime.compactor = _RecordingCompactor(progress=False)
    session = StudioSession()
    _seed_history(session)
    events = _collect(runtime, session)
    force_calls = [c for c in runtime.compactor.calls if c["force"] is True]
    assert len(force_calls) <= 1
    terminal = [e for e in events if e["type"] == EventType.ERROR.value]
    assert terminal
    assert terminal[-1]["data"].get("detector") == "context_window"
    assert events[-1]["type"] != EventType.FINAL.value


def test_overflow_retry_respects_max(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_OVERFLOW_RETRY", raising=False)
    monkeypatch.delenv("AGX_MAX_OVERFLOW_RETRIES", raising=False)
    llm = _AlwaysOverflow()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=8)
    runtime.compactor = _RecordingCompactor(progress=True)
    session = StudioSession()
    _seed_history(session, n=12)
    events = _collect(runtime, session)
    retry_events = [
        e
        for e in events
        if e["type"] == EventType.ERROR.value
        and e["data"].get("detector") == "context_overflow_compact_retry"
    ]
    assert len(retry_events) == 2


def test_overflow_retry_flag_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_OVERFLOW_RETRY", "0")
    llm = _OverflowThenOk()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=4)
    runtime.compactor = _RecordingCompactor(progress=True)
    session = StudioSession()
    _seed_history(session)
    events = _collect(runtime, session)
    assert not any(c["force"] is True for c in runtime.compactor.calls)
    assert llm.calls == 1
    terminal = [e for e in events if e["type"] == EventType.ERROR.value]
    assert terminal
    assert terminal[-1]["data"].get("detector") == "context_window"
