#!/usr/bin/env python3
"""Smoke tests for DeerFlow-inspired guardrails (AllowlistProvider + ToolGuardrailHook).

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.tools.guardrails.builtin import AllowlistProvider
from agenticx.tools.guardrails.hook import ToolGuardrailHook
from agenticx.tools.guardrails.provider import (
    GuardrailDecision,
    GuardrailReason,
    GuardrailRequest,
)


class _Session:
    session_id = "sid-1"


@pytest.mark.asyncio
async def test_allow_when_not_denied() -> None:
    hook = ToolGuardrailHook(AllowlistProvider(denied_tools=["bash"]))
    out = await hook.before_tool_call("read_file", {}, _Session())
    assert out is None


@pytest.mark.asyncio
async def test_deny_when_on_denylist() -> None:
    hook = ToolGuardrailHook(AllowlistProvider(denied_tools=["bash"]))
    out = await hook.before_tool_call("bash", {"x": 1}, _Session())
    assert out is not None
    assert out.blocked is True
    assert "bash" in (out.reason or "")


@pytest.mark.asyncio
async def test_deny_when_not_on_allowlist() -> None:
    hook = ToolGuardrailHook(AllowlistProvider(allowed_tools=["read_file"]))
    out = await hook.before_tool_call("bash", {}, _Session())
    assert out is not None
    assert out.blocked is True


@pytest.mark.asyncio
async def test_fail_closed_on_provider_error() -> None:
    class _Boom:
        name = "boom"

        def evaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            raise RuntimeError("boom")

        async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            raise RuntimeError("boom")

    hook = ToolGuardrailHook(_Boom(), fail_closed=True)
    out = await hook.before_tool_call("any_tool", {}, _Session())
    assert out is not None
    assert out.blocked is True
    assert "fail-closed" in (out.reason or "")


@pytest.mark.asyncio
async def test_fail_open_on_provider_error() -> None:
    class _Boom:
        name = "boom"

        def evaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            raise RuntimeError("boom")

        async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            raise RuntimeError("boom")

    hook = ToolGuardrailHook(_Boom(), fail_closed=False)
    out = await hook.before_tool_call("any_tool", {}, _Session())
    assert out is None


def test_allowlist_provider_sync_allow() -> None:
    p = AllowlistProvider(denied_tools=["bash"])
    d = p.evaluate(GuardrailRequest(tool_name="ok", tool_input={}))
    assert d.allow is True


@pytest.mark.asyncio
async def test_hook_denies_when_decision_has_no_reasons() -> None:
    class _Weird:
        name = "weird"

        def evaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            return GuardrailDecision(allow=False, reasons=[])

        async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision:
            return GuardrailDecision(allow=False, reasons=[])

    hook = ToolGuardrailHook(_Weird())
    out = await hook.before_tool_call("t", {}, _Session())
    assert out is not None and out.blocked
    assert "agx.denied" in (out.reason or "")
