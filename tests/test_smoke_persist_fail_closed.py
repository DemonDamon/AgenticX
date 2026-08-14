#!/usr/bin/env python3
"""Smoke tests for persist-before-side-effect fail-closed (G-002).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.agent_runtime import _sanitize_context_messages


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _FakeResponse:
    def __init__(self, content: str = "done", tool_calls: list | None = None) -> None:
        self.content = content
        self.tool_calls = tool_calls or []
        self.finish_reason = "stop"
        self.reasoning_content = ""


class _TextThenDone:
    def __init__(self) -> None:
        self.invoke_calls = 0

    def invoke(self, *_args, **_kwargs):
        self.invoke_calls += 1
        return _FakeResponse("全部完成")


class _OneToolThenDone:
    def __init__(self) -> None:
        self.invoke_calls = 0

    def invoke(self, *_args, **_kwargs):
        self.invoke_calls += 1
        if self.invoke_calls == 1:
            return _FakeResponse(
                " ",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "todo_write",
                            "arguments": json.dumps(
                                {"todos": [{"content": "step", "status": "pending"}]}
                            ),
                        },
                    }
                ],
            )
        return _FakeResponse("全部完成")


def _collect(runtime: AgentRuntime, session: StudioSession, text: str = "go") -> List[Dict[str, Any]]:
    async def _run() -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        async for event in runtime.run_turn(text, session):
            events.append({"type": event.type, "data": event.data})
        return events

    return asyncio.run(_run())


def test_persist_fail_blocks_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "1")

    def _boom() -> None:
        raise OSError("disk full")

    llm = _TextThenDone()
    runtime = AgentRuntime(llm, _ApproveGate(), mid_turn_persist=_boom, max_tool_rounds=3)
    session = StudioSession()
    events = _collect(runtime, session)
    assert llm.invoke_calls == 0
    assert any(
        e["type"] == EventType.ERROR.value and e["data"].get("detector") == "persist_fail_closed"
        for e in events
    )


def test_persist_fail_skips_tool_and_keeps_pairing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "1")
    persist_calls = {"n": 0}
    dispatch_calls = {"n": 0}

    def _persist() -> None:
        persist_calls["n"] += 1
        if persist_calls["n"] >= 3:
            raise OSError("disk full")

    async def _fake_dispatch(*_args, **_kwargs):
        dispatch_calls["n"] += 1
        return "should-not-run"

    monkeypatch.setattr("agenticx.runtime.agent_runtime.dispatch_tool_async", _fake_dispatch)
    llm = _OneToolThenDone()
    runtime = AgentRuntime(llm, _ApproveGate(), mid_turn_persist=_persist, max_tool_rounds=4)
    session = StudioSession()
    _collect(runtime, session)
    assert dispatch_calls["n"] == 0
    sanitized = _sanitize_context_messages(session.agent_messages)
    ids = set()
    answered = set()
    for msg in sanitized:
        if msg.get("role") == "assistant":
            for call in msg.get("tool_calls") or []:
                ids.add(str(call.get("id", "")))
        if msg.get("role") == "tool":
            answered.add(str(msg.get("tool_call_id", "")))
    assert "call-1" in ids
    assert ids <= answered


def test_persist_fail_flag_off_still_runs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "0")
    caplog.set_level(logging.ERROR)

    def _boom() -> None:
        raise OSError("disk full")

    llm = _OneToolThenDone()
    runtime = AgentRuntime(llm, _ApproveGate(), mid_turn_persist=_boom, max_tool_rounds=4)
    session = StudioSession()
    events = _collect(runtime, session)
    assert llm.invoke_calls >= 1
    assert any(e["type"] == EventType.TOOL_RESULT.value for e in events)
    assert "persist before" in caplog.text


def test_persist_counters_only_reset_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "0")
    ok_runtime = AgentRuntime(_TextThenDone(), _ApproveGate(), mid_turn_persist=lambda: None)
    before = ok_runtime._last_persist_time
    ok, _detail = ok_runtime._persist_or_abort("llm_request")
    assert ok is True
    assert ok_runtime._last_persist_time >= before

    def _boom() -> None:
        raise OSError("disk full")

    fail_runtime = AgentRuntime(_TextThenDone(), _ApproveGate(), mid_turn_persist=_boom)
    fail_runtime._persist_tool_count = 1
    fail_runtime._tools_since_persist = 3
    fail_runtime._maybe_mid_turn_persist()
    assert fail_runtime._tools_since_persist == 3
