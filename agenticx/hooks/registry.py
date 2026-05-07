"""Unified async hook registry.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from concurrent.futures import TimeoutError as FuturesTimeoutError
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from .types import HookEvent, HookHandler

logger = logging.getLogger(__name__)
_SYNC_TRIGGER_EXECUTOR = ThreadPoolExecutor(max_workers=1)
_SYNC_TRIGGER_TIMEOUT_SECONDS = 8.0


class HookRegistry:
    """Registers and triggers hook handlers by event keys.

    Event keys support both generic and scoped formats:
    - ``command``
    - ``command:new``
    """

    def __init__(self) -> None:
        self._handlers: Dict[str, List[HookHandler]] = defaultdict(list)

    def register(self, event_key: str, handler: HookHandler) -> None:
        if handler not in self._handlers[event_key]:
            self._handlers[event_key].append(handler)

    def unregister(self, event_key: str, handler: HookHandler) -> bool:
        handlers = self._handlers.get(event_key)
        if not handlers:
            return False
        try:
            handlers.remove(handler)
            if not handlers:
                self._handlers.pop(event_key, None)
            return True
        except ValueError:
            return False

    def clear(self) -> None:
        self._handlers.clear()

    def get_registered_keys(self) -> List[str]:
        return list(self._handlers.keys())

    def get_registered_handlers(self, event_key: str) -> List[HookHandler]:
        return self._handlers.get(event_key, []).copy()

    async def trigger(self, event: HookEvent) -> bool:
        """Trigger both generic and specific handlers in order.

        Returns ``False`` if any handler explicitly returns False.
        """

        event_type_handlers = self._handlers.get(event.type, [])
        specific_handlers = self._handlers.get(f"{event.type}:{event.action}", [])
        all_handlers = [*event_type_handlers, *specific_handlers]

        should_continue = True
        for handler in all_handlers:
            try:
                result = await handler(event)
                if result is False:
                    should_continue = False
            except Exception as exc:  # pragma: no cover - defensive path
                logger.warning("Hook handler failed for %s:%s: %s", event.type, event.action, exc)
        return should_continue

    def trigger_sync(self, event: HookEvent) -> bool:
        """Sync wrapper for environments that are not async-first."""

        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None

        if running_loop and running_loop.is_running():
            # Execute in a separate thread to preserve blocking semantics.
            future = _SYNC_TRIGGER_EXECUTOR.submit(lambda: asyncio.run(self.trigger(event)))
            try:
                return bool(future.result(timeout=_SYNC_TRIGGER_TIMEOUT_SECONDS))
            except FuturesTimeoutError:
                logger.warning(
                    "Hook trigger timed out for %s:%s after %.1fs",
                    event.type,
                    event.action,
                    _SYNC_TRIGGER_TIMEOUT_SECONDS,
                )
                return False
        return asyncio.run(self.trigger(event))


_GLOBAL_REGISTRY = HookRegistry()


def get_global_hook_registry() -> HookRegistry:
    return _GLOBAL_REGISTRY


def dispatch_hook_event_sync(
    *,
    hook_type: str,
    action: str,
    context_payload: Dict[str, Any],
    agent_id: str = "longrun",
    session_key: str = "",
    task_id: Optional[str] = None,
) -> bool:
    """Fire-and-forget sync dispatch through :class:`HookRegistry`.

    Used by ``agenticx.longrun`` task workspace lifecycle hooks. Payload lands in
    :attr:`HookEvent.context` (merged shallow-copy); callers may include keys such as
    ``cwd``, ``workspace_path``, ``phase``.
    """

    evt = HookEvent(
        type=str(hook_type or "").strip(),
        action=str(action or "").strip(),
        agent_id=str(agent_id or "").strip() or "longrun",
        session_key=str(session_key or "").strip(),
        task_id=task_id,
        context=dict(context_payload or {}),
    )
    return bool(get_global_hook_registry().trigger_sync(evt))

