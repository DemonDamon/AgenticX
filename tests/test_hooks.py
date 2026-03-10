#!/usr/bin/env python3
"""Tests for runtime hook registry."""

from __future__ import annotations

import asyncio

from agenticx.runtime.hooks import AgentHook, HookOutcome, HookRegistry


class _PatchMessageHook(AgentHook):
    async def before_model(self, messages, _session):
        updated = list(messages)
        updated.append({"role": "system", "content": "hook-added"})
        return updated


class _BlockToolHook(AgentHook):
    async def before_tool_call(self, tool_name, _arguments, _session):
        if tool_name == "danger":
            return HookOutcome(blocked=True, reason="blocked by hook")
        return HookOutcome(blocked=False, reason="")


def test_hook_registry_before_model_can_rewrite_messages() -> None:
    registry = HookRegistry()
    registry.register(_PatchMessageHook())
    messages = [{"role": "user", "content": "hello"}]
    updated = asyncio.run(registry.run_before_model(messages, object()))
    assert len(updated) == 2
    assert updated[-1]["content"] == "hook-added"


def test_hook_registry_can_block_tool_call() -> None:
    registry = HookRegistry()
    registry.register(_BlockToolHook())
    outcome = asyncio.run(registry.run_before_tool_call("danger", {}, object()))
    assert outcome.blocked is True
    assert "blocked" in outcome.reason
