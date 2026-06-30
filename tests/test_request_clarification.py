#!/usr/bin/env python3
"""Unit tests for the request_clarification HITL primitive.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.agent_tools import (
    _request_clarification,
    build_clarification_tool_result,
)
from agenticx.runtime.clarify import (
    AsyncClarifyGate,
    AutoSuspendClarifyGate,
)


def test_build_clarification_tool_result_with_options_and_text() -> None:
    out = build_clarification_tool_result(
        {"answer_text": "配色用深蓝紫+科技金", "selected_options": ["锁定 2 分钟"]}
    )
    assert "锁定 2 分钟" in out
    assert "配色用深蓝紫+科技金" in out
    assert out.endswith("。")


def test_build_clarification_tool_result_only_options() -> None:
    out = build_clarification_tool_result({"answer_text": "", "selected_options": ["A", "B"]})
    assert out == "用户选择：A；B。"


def test_build_clarification_tool_result_only_text() -> None:
    out = build_clarification_tool_result({"answer_text": "自由文本", "selected_options": []})
    assert out == "自定义补充：自由文本。"


def test_build_clarification_tool_result_empty() -> None:
    out = build_clarification_tool_result({"answer_text": "", "selected_options": []})
    assert "默认方案" in out


def test_build_clarification_tool_result_timeout_sentinel() -> None:
    out = build_clarification_tool_result({"__timeout__": True})
    assert out.startswith("[CLARIFICATION_TIMEOUT]")


def test_build_clarification_tool_result_suspended_sentinel() -> None:
    out = build_clarification_tool_result({"__suspended__": True})
    assert out.startswith("[CLARIFICATION_PENDING]")


def test_async_clarify_gate_resolve_returns_structured_answer() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)

    async def _resolve_after() -> None:
        await asyncio.sleep(0.05)
        gate.resolve("req-1", {"answer_text": "hi", "selected_options": ["ok"]})

    async def _main() -> Dict[str, Any]:
        task = asyncio.create_task(_resolve_after())
        answer = await gate.request_clarification(
            "pick one", options=["ok"], allow_free_text=True, context={"request_id": "req-1"}
        )
        await task
        return answer

    answer = asyncio.run(_main())
    assert answer == {"answer_text": "hi", "selected_options": ["ok"]}


def test_async_clarify_gate_resolve_idempotent() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)

    async def _main() -> None:
        fut = asyncio.get_running_loop().create_future()
        gate._pending["req-x"] = fut
        assert gate.resolve("req-x", {"answer_text": "a"}) is True
        # Second resolve on the same (still-pending) future must be a no-op.
        assert gate.resolve("req-x", {"answer_text": "b"}) is False
        assert not fut.done() or fut.result() == {"answer_text": "a"}

    asyncio.run(_main())


def test_async_clarify_gate_timeout_returns_sentinel() -> None:
    gate = AsyncClarifyGate(timeout_seconds=0.05)

    async def _main() -> Dict[str, Any]:
        return await gate.request_clarification(
            "no one will answer", options=[], allow_free_text=True
        )

    answer = asyncio.run(_main())
    assert answer.get("__timeout__") is True


def test_auto_suspend_clarify_gate_returns_suspended_immediately() -> None:
    gate = AutoSuspendClarifyGate()

    async def _main() -> Dict[str, Any]:
        return await gate.request_clarification("q", options=["a"], allow_free_text=True)

    answer = asyncio.run(_main())
    assert answer.get("__suspended__") is True


def test_request_clarification_unattended_emits_suspended_and_returns_sentinel() -> None:
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "plan sign-off?",
            options=["lock 2min"],
            allow_free_text=True,
            context=None,
            clarify_gate=AsyncClarifyGate(timeout_seconds=1.0),
            emit_event=emit,
            is_unattended=True,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_PENDING]")
    assert any(e["type"] == "clarification_suspended" for e in events)


def test_request_clarification_auto_suspend_gate_returns_sentinel() -> None:
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "q",
            options=[],
            allow_free_text=False,
            clarify_gate=AutoSuspendClarifyGate(),
            emit_event=emit,
            is_unattended=False,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_PENDING]")


def test_request_clarification_normal_round_trip() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _resolve_after() -> None:
        await asyncio.sleep(0.05)
        gate.resolve("req-rt", {"answer_text": "ok", "selected_options": ["A"]})

    async def _main() -> str:
        task = asyncio.create_task(_resolve_after())
        result = await _request_clarification(
            "choose",
            options=["A", "B"],
            allow_free_text=True,
            context={"request_id": "req-rt"},
            clarify_gate=gate,
            emit_event=emit,
            is_unattended=False,
        )
        await task
        return result

    result = asyncio.run(_main())
    assert "A" in result
    assert "ok" in result
    types = [e["type"] for e in events]
    assert "clarification_required" in types
    assert "clarification_response" in types


def test_request_clarification_timeout_returns_sentinel() -> None:
    gate = AsyncClarifyGate(timeout_seconds=0.05)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "q",
            options=[],
            allow_free_text=True,
            clarify_gate=gate,
            emit_event=emit,
            is_unattended=False,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_TIMEOUT]")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
