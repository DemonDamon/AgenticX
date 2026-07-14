#!/usr/bin/env python3
"""Unit tests for the request_action_confirmation HITL primitive.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.agent_tools import (
    STUDIO_TOOLS,
    _request_action_confirmation,
    build_action_confirmation_tool_result,
)
from agenticx.runtime.clarify import AsyncClarifyGate, AutoSuspendClarifyGate


def _action_tool_schema() -> Dict[str, Any]:
    for item in STUDIO_TOOLS:
        fn = (item.get("function") or {}) if isinstance(item, dict) else {}
        if fn.get("name") == "request_action_confirmation":
            return fn
    raise AssertionError("request_action_confirmation schema missing")


def test_request_action_confirmation_schema_exists() -> None:
    fn = _action_tool_schema()
    params = fn.get("parameters") or {}
    props = params.get("properties") or {}
    assert "title" in props
    assert "summary" in props
    assert params.get("required") == ["title"]
    summary_items = ((props.get("summary") or {}).get("items") or {}).get("properties") or {}
    assert "label" in summary_items
    assert "value" in summary_items


def test_build_action_confirmation_tool_result_approved() -> None:
    out = build_action_confirmation_tool_result(
        {"answer_text": "", "selected_options": ["确认发送"]},
        approve_label="确认发送",
        reject_label="取消",
    )
    assert out.startswith("[ACTION_CONFIRMED]")


def test_build_action_confirmation_tool_result_rejected() -> None:
    out = build_action_confirmation_tool_result(
        {"answer_text": "", "selected_options": ["取消"]},
        approve_label="确认发送",
        reject_label="取消",
    )
    assert out.startswith("[ACTION_REJECTED]")
    assert "不得继续" in out


def test_build_action_confirmation_tool_result_timeout_and_suspended() -> None:
    assert build_action_confirmation_tool_result({"__timeout__": True}).startswith(
        "[ACTION_CONFIRMATION_EXPIRED]"
    )
    assert build_action_confirmation_tool_result({"__suspended__": True}).startswith(
        "[ACTION_CONFIRMATION_SUSPENDED]"
    )


def test_request_action_confirmation_timeout_clears_pending(monkeypatch) -> None:
    gate = AsyncClarifyGate(timeout_seconds=30.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    monkeypatch.setattr(
        "agenticx.cli.agent_tools._clamp_action_confirmation_ttl",
        lambda _raw: 0.05,
    )

    async def _main() -> str:
        return await _request_action_confirmation(
            title="确认发布？",
            summary=[{"label": "目标", "value": "blog"}],
            approve_label="确认执行",
            reject_label="取消",
            expires_in_seconds=0.05,
            clarify_gate=gate,
            emit_event=emit,
        )

    out = asyncio.run(_main())
    assert out.startswith("[ACTION_CONFIRMATION_EXPIRED]")
    assert gate.has_pending() is False
    assert events and events[0]["type"] == "clarification_required"
    ctx = events[0]["data"]["context"]
    assert ctx["kind"] == "action_confirmation"
    assert ctx["title"] == "确认发布？"
    assert "approve_label" in ctx
    assert "reject_label" in ctx
    assert "expires_at_ms" in ctx
    assert "secret" not in ctx


def test_request_action_confirmation_approved_via_gate() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _resolve_after() -> None:
        await asyncio.sleep(0.05)
        req_id = events[0]["data"]["id"]
        gate.resolve(req_id, {"answer_text": "", "selected_options": ["确认执行"]})

    async def _main() -> str:
        task = asyncio.create_task(_resolve_after())
        out = await _request_action_confirmation(
            title="确认？",
            clarify_gate=gate,
            emit_event=emit,
            expires_in_seconds=5,
        )
        await task
        return out

    out = asyncio.run(_main())
    assert out.startswith("[ACTION_CONFIRMED]")


def test_request_action_confirmation_unattended_suspended() -> None:
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_action_confirmation(
            title="确认？",
            clarify_gate=AutoSuspendClarifyGate(),
            emit_event=emit,
            is_unattended=True,
        )

    out = asyncio.run(_main())
    assert out.startswith("[ACTION_CONFIRMATION_SUSPENDED]")
    assert events and events[0]["type"] == "clarification_suspended"


def test_expires_in_seconds_clamped_and_summary_normalized() -> None:
    from agenticx.cli import agent_tools as tools

    gate = AsyncClarifyGate(timeout_seconds=5.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _resolve_after() -> None:
        for _ in range(50):
            if events:
                break
            await asyncio.sleep(0.01)
        req_id = events[0]["data"]["id"]
        gate.resolve(
            req_id,
            {"answer_text": "", "selected_options": ["确认执行"]},
        )

    async def _main() -> Dict[str, Any]:
        task = asyncio.create_task(_resolve_after())
        await _request_action_confirmation(
            title="t",
            summary=[
                {"label": "L" * 80, "value": "V" * 1200, "extra": "x"},
                "bad-row",
            ]
            + [{"label": f"k{i}", "value": f"v{i}"} for i in range(20)],
            expires_in_seconds=5,
            source="Agent Mail",
            clarify_gate=gate,
            emit_event=emit,
            # caller-controlled kind must not override / leak into context
            caller_context={"kind": "evil", "oauth_token": "secret"},
        )
        await task
        return events[0]["data"]["context"]

    ctx = asyncio.run(_main())
    assert ctx["kind"] == "action_confirmation"
    assert "oauth_token" not in ctx
    assert len(ctx["summary"]) == 12
    assert len(ctx["summary"][0]["label"]) == 40
    assert len(ctx["summary"][0]["value"]) == 1000
    # 5s is below min 30 → clamped to 30
    assert tools._clamp_action_confirmation_ttl(5) == 30.0
    assert ctx["expires_at_ms"] > 0