#!/usr/bin/env python3
"""Regression tests for fail-closed automatic confirmation policy."""

from __future__ import annotations

import asyncio

from agenticx.cli.agent_tools import _confirm
from agenticx.runtime.confirm import (
    PROTECTED_CONFIRM_RISKS,
    AsyncConfirmGate,
    RiskAwareAutoConfirmGate,
    is_protected_confirm,
    normalize_confirm_risk,
)


def test_only_explicit_low_risk_is_auto_approvable() -> None:
    assert normalize_confirm_risk({"risk": " low "}) == "low"
    assert is_protected_confirm({"risk": "low"}) is False

    for risk in PROTECTED_CONFIRM_RISKS | {"unknown", "typo-high"}:
        assert is_protected_confirm({"risk": risk}) is True
    assert is_protected_confirm({}) is True
    assert is_protected_confirm(None) is True


def test_unattended_gate_approves_low_and_rejects_protected_without_pending() -> None:
    async def _run() -> None:
        gate = RiskAwareAutoConfirmGate(unattended=True)

        assert await gate.request_confirm("write?", {"risk": "low"}) is True
        assert await gate.request_confirm("delete?", {"risk": "destructive"}) is False
        assert gate.last_request is not None
        assert gate.last_request["decision"] == "blocked_unattended"
        assert gate._pending == {}

    asyncio.run(_run())


def test_interactive_auto_gate_delegates_protected_but_not_low_risk() -> None:
    async def _run() -> None:
        delegate = AsyncConfirmGate(timeout_seconds=1)
        gate = RiskAwareAutoConfirmGate(delegate=delegate)

        assert gate.should_emit_prompt({"risk": "low"}) is False
        assert await gate.request_confirm("write?", {"risk": "low"}) is True
        assert delegate.last_request is None

        context = {"risk": "high", "request_id": "confirm-high"}
        assert gate.should_emit_prompt(context) is True
        pending = asyncio.create_task(gate.request_confirm("run?", context))
        await asyncio.sleep(0)
        assert "confirm-high" in delegate._pending
        assert gate.resolve("confirm-high", True) is True
        assert await pending is True

    asyncio.run(_run())


def test_protected_timeout_cannot_inherit_auto_approve_timeout_policy() -> None:
    async def _run() -> None:
        protected = AsyncConfirmGate(timeout_seconds=0.001, timeout_action="approve")
        low = AsyncConfirmGate(timeout_seconds=0.001, timeout_action="approve")

        assert await protected.request_confirm("danger?", {"risk": "high"}) is False
        assert protected.last_timeout_info is not None
        assert protected.last_timeout_info["action_taken"] == "reject"
        assert protected.last_timeout_info["configured_action"] == "approve"
        assert await low.request_confirm("safe?", {"risk": "low"}) is True

    asyncio.run(_run())


def test_confirm_events_follow_gate_capability_and_risk() -> None:
    async def _run() -> None:
        events: list[dict] = []
        delegate = AsyncConfirmGate(timeout_seconds=1)
        gate = RiskAwareAutoConfirmGate(delegate=delegate)

        async def emit(event: dict) -> None:
            events.append(event)
            if event["type"] == "confirm_required":
                assert gate.resolve(event["data"]["id"], True)

        assert await _confirm(
            "write?",
            confirm_gate=gate,
            context={"risk": "low", "tool": "file_write"},
            emit_event=emit,
        ) is True
        assert events == []

        assert await _confirm(
            "run?",
            confirm_gate=gate,
            context={"risk": "high", "tool": "bash_exec"},
            emit_event=emit,
        ) is True
        assert [event["type"] for event in events] == [
            "confirm_required",
            "confirm_response",
        ]

        events.clear()
        unattended = RiskAwareAutoConfirmGate(unattended=True)
        assert await _confirm(
            "delete?",
            confirm_gate=unattended,
            context={"risk": "destructive"},
            emit_event=emit,
        ) is False
        assert events == []

    asyncio.run(_run())
