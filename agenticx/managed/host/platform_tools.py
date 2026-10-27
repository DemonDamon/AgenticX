#!/usr/bin/env python3
"""Host-injected platform tools layered in front of custom tool resolution.

Author: Damon Li
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from agenticx.tools.fallback_chain import ToolResolver

logger = logging.getLogger(__name__)

PlatformHandler = Callable[[dict[str, Any], str | None], Awaitable[str]]
"""handler(arguments, tool_call_id) -> result text. Must not raise."""


class PlatformToolResolver(ToolResolver):
    """Host-injected tools first, then the wrapped custom-tool resolver.

    ``resolve`` strips keys starting with ``__`` from kwargs before calling a
    platform handler and passes ``kwargs.get("__tool_call_id")`` separately.
    """

    def __init__(self, delegate: ToolResolver | None) -> None:
        self._delegate = delegate
        self._handlers: dict[str, PlatformHandler] = {}
        self._schemas: list[dict[str, Any]] = []

    def register(self, name: str, schema: dict[str, Any], handler: PlatformHandler) -> None:
        """Duplicate name -> ValueError."""
        if name in self._handlers:
            raise ValueError(f"platform tool already registered: {name}")
        self._handlers[name] = handler
        self._schemas.append(schema)

    def names(self) -> frozenset[str]:
        return frozenset(self._handlers)

    def schemas(self) -> list[dict[str, Any]]:
        """Deep copies of registered schemas, in registration order."""
        return [copy.deepcopy(schema) for schema in self._schemas]

    async def can_handle(self, task_intent: str) -> bool:
        if task_intent in self._handlers:
            return True
        if self._delegate is None:
            return False
        return await self._delegate.can_handle(task_intent)

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        handler = self._handlers.get(task_intent)
        if handler is not None:
            arguments = {
                key: value
                for key, value in kwargs.items()
                if not str(key).startswith("__")
            }
            raw_call_id = kwargs.get("__tool_call_id")
            tool_call_id = raw_call_id if isinstance(raw_call_id, str) else None
            try:
                return await handler(arguments, tool_call_id)
            except Exception:
                logger.exception("platform tool failed name=%s", task_intent)
                return f"ERROR: tool {task_intent} failed"
        if self._delegate is not None:
            return await self._delegate.resolve(task_intent, **kwargs)
        return f"ERROR: unknown tool '{task_intent}'"


__all__ = [
    "PlatformHandler",
    "PlatformToolResolver",
]
