#!/usr/bin/env python3
"""Event store that notifies listeners after session events commit.

Terminal listeners see idle and terminated status events. Event listeners see
only the types they subscribe to. Listeners are scheduled with
``asyncio.create_task`` and are never awaited inside ``append_events``.
Session actors hold their lock across that call.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from agenticx.managed.events.store import StoredEvent

from ma_agent_runtime.pg_event_store import PgEventStore

logger = logging.getLogger(__name__)

TERMINAL_EVENT_TYPES = frozenset({"session.status_idle", "session.status_terminated"})
TerminalListener = Callable[[str, str, StoredEvent], Awaitable[None]]


class HookedPgEventStore(PgEventStore):
    """PgEventStore that notifies listeners after subscribed events are committed."""

    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] | None = None) -> None:
        super().__init__(engine, clock=clock)
        self._listeners: list[TerminalListener] = []
        self._event_listeners: list[tuple[frozenset[str], TerminalListener]] = []
        self._tasks: set[asyncio.Task[None]] = set()

    def add_terminal_listener(self, listener: TerminalListener) -> None:
        self._listeners.append(listener)

    def add_event_listener(self, listener: TerminalListener, types: frozenset[str]) -> None:
        self._event_listeners.append((types, listener))

    async def append_events(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        stored = await super().append_events(tenant_id, session_id, events)
        for item in stored:
            if item.type not in TERMINAL_EVENT_TYPES:
                continue
            for listener in list(self._listeners):
                task = asyncio.create_task(self._safe(listener, tenant_id, session_id, item))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
        for item in stored:
            for types, listener in list(self._event_listeners):
                if item.type not in types:
                    continue
                task = asyncio.create_task(self._safe(listener, tenant_id, session_id, item))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
        return stored

    async def drain(self) -> None:
        """Wait for listener tasks started by ``append_events``."""
        pending = [task for task in self._tasks if not task.done()]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def _safe(
        self,
        listener: TerminalListener,
        tenant_id: str,
        session_id: str,
        event: StoredEvent,
    ) -> None:
        try:
            await listener(tenant_id, session_id, event)
        except Exception:
            logger.exception("terminal listener failed session=%s", session_id)


__all__ = [
    "TERMINAL_EVENT_TYPES",
    "HookedPgEventStore",
    "TerminalListener",
]
