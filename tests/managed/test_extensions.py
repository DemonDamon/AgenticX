#!/usr/bin/env python3
"""Session extension helpers: resolver order and hook chaining.

Author: Damon Li
"""

from __future__ import annotations

import logging

from agenticx.managed.extensions import CompositeToolResolver, DynamicHook
from agenticx.runtime.hooks import AgentHook, HookOutcome
from agenticx.tools.fallback_chain import ToolResolver


class _Ok(ToolResolver):
    def __init__(self, name: str, result: str, *, handle: bool = True) -> None:
        self._name = name
        self._result = result
        self._handle = handle
        self.calls = 0

    async def can_handle(self, task_intent: str) -> bool:
        del task_intent
        return self._handle

    async def resolve(self, task_intent: str, **kwargs: object) -> str:
        del task_intent, kwargs
        self.calls += 1
        return self._result


class _Boom(ToolResolver):
    async def can_handle(self, task_intent: str) -> bool:
        del task_intent
        return True

    async def resolve(self, task_intent: str, **kwargs: object) -> str:
        del task_intent, kwargs
        raise RuntimeError("tok-secret")


class _Skip(ToolResolver):
    async def can_handle(self, task_intent: str) -> bool:
        del task_intent
        return False

    async def resolve(self, task_intent: str, **kwargs: object) -> str:
        del task_intent, kwargs
        return "nope"


class _Hook(AgentHook):
    def __init__(self, tag: str, *, block: bool = False) -> None:
        self._tag = tag
        self._block = block
        self.before_calls = 0
        self.after_calls = 0

    async def before_tool_call(self, tool_name: str, arguments: dict, session: object):
        del tool_name, arguments, session
        self.before_calls += 1
        if self._block:
            return HookOutcome(blocked=True, reason="stop")
        return None

    async def after_tool_call(self, tool_name: str, result: str, session: object) -> str:
        del tool_name, session
        self.after_calls += 1
        return result + self._tag


async def test_composite_resolver_order_and_errors(caplog) -> None:
    caplog.set_level(logging.ERROR)
    first = _Ok("a", "from-first")
    second = _Ok("b", "from-second")
    ordered = CompositeToolResolver([first, second])
    assert await ordered.resolve("x") == "from-first"
    assert first.calls == 1
    assert second.calls == 0

    secret = "tok-secret" # gitleaks:allow
    boom = CompositeToolResolver([_Boom()])
    failed = await boom.resolve("x")
    assert failed == "ERROR: tool x failed"
    assert secret not in failed
    assert secret not in caplog.text

    unknown = CompositeToolResolver([_Skip()])
    assert await unknown.resolve("x") == "ERROR: unknown tool 'x'"


async def test_dynamic_hook_chain() -> None:
    first = _Hook("-a")
    second = _Hook("-b")
    hook = DynamicHook()
    hook.set([first, second])
    assert await hook.after_tool_call("bash_exec", "out", None) == "out-a-b"
    assert first.after_calls == 1
    assert second.after_calls == 1

    blocker = _Hook("-block", block=True)
    later = _Hook("-later")
    hook.set([blocker, later])
    outcome = await hook.before_tool_call("bash_exec", {}, None)
    assert outcome is not None and outcome.blocked is True
    assert blocker.before_calls == 1
    assert later.before_calls == 0
