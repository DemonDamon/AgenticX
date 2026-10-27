#!/usr/bin/env python3
"""Pre-request budget guard for managed sessions.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable, Iterator
from typing import Any

from agenticx.managed.llm import LLMCallContext, LLMFactory

BUDGET_EXCEEDED_MARKER = "agx_budget_exceeded"
_GUARDED_METHODS = frozenset({"invoke", "stream", "stream_with_tools", "ainvoke"})

BudgetGuard = Callable[[LLMCallContext], None]
BudgetObserve = Callable[[LLMCallContext, Any], None]


class BudgetExceededError(RuntimeError):
    """Raised by a budget guard. The message always starts with the marker."""

    def __init__(self, *, period: str, used: int, limit: int) -> None:
        self.period, self.used, self.limit = period, used, limit
        super().__init__(
            f"{BUDGET_EXCEEDED_MARKER}: {period} token quota reached (used={used}, limit={limit})"
        )


def _usage_pair(item: Any) -> tuple[int, int] | None:
    """Return prompt and completion tokens from one streamed usage chunk."""
    if not isinstance(item, dict) or item.get("type") != "usage":
        return None
    usage = item.get("usage")
    if not isinstance(usage, dict):
        return None
    try:
        prompt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        completion = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    except (TypeError, ValueError):
        return None
    if prompt < 0 or completion < 0:
        return None
    if prompt == 0 and completion == 0:
        return None
    return prompt, completion


def _iter_observed(source: Any, observe: Callable[[Any], None]) -> Iterator[Any]:
    """Yield stream chunks and report the largest usage pair once the stream ends."""
    best_prompt = 0
    best_completion = 0
    try:
        for item in source:
            found = _usage_pair(item)
            if found is not None and found[0] + found[1] >= best_prompt + best_completion:
                best_prompt, best_completion = found
            yield item
    finally:
        if best_prompt + best_completion > 0:
            observe(
                {
                    "type": "usage",
                    "usage": {
                        "prompt_tokens": best_prompt,
                        "completion_tokens": best_completion,
                    },
                }
            )


class _GuardedLLM:
    """Proxy that runs the guard before each model request and delegates everything else."""

    def __init__(
        self,
        inner: Any,
        check: Callable[[], None],
        observe: Callable[[Any], None] | None = None,
    ) -> None:
        object.__setattr__(self, "_inner", inner)
        object.__setattr__(self, "_check", check)
        object.__setattr__(self, "_observe", observe)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name not in _GUARDED_METHODS or not callable(attr):
            return attr
        observe: Callable[[Any], None] | None = self._observe
        if inspect.iscoroutinefunction(attr):

            async def guarded_async(*args: Any, **kwargs: Any) -> Any:
                await asyncio.to_thread(self._check)
                result = await attr(*args, **kwargs)
                if observe is not None:
                    observe(result)
                return result

            return guarded_async

        def guarded(*args: Any, **kwargs: Any) -> Any:
            self._check()
            result = attr(*args, **kwargs)
            if observe is None:
                return result
            if inspect.isgenerator(result):
                return _iter_observed(result, observe)
            observe(result)
            return result

        return guarded

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._inner, name, value)

    def __repr__(self) -> str:
        return f"Budgeted({self._inner!r})"


class BudgetGuardedLLMFactory:
    """LLMFactory wrapper. ``guard(context)`` raises BudgetExceededError to stop a request."""

    def __init__(
        self,
        inner: LLMFactory,
        guard: BudgetGuard,
        observe: BudgetObserve | None = None,
    ) -> None:
        self._inner = inner
        self._guard = guard
        self._observe = observe

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        llm = self._inner.create(provider=provider, model=model, context=context)
        observe = self._observe

        def note(item: Any) -> None:
            if observe is not None:
                observe(context, item)

        return _GuardedLLM(llm, lambda: self._guard(context), note if observe is not None else None)


__all__ = [
    "BUDGET_EXCEEDED_MARKER",
    "BudgetExceededError",
    "BudgetGuard",
    "BudgetGuardedLLMFactory",
    "BudgetObserve",
]
