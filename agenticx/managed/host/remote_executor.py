#!/usr/bin/env python3
"""Turn executor that queues work for a desktop worker.

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.actor import SessionActor
from agenticx.managed.host.work_queue import SqliteWorkQueue
from agenticx.managed.protocol import ClientEvent


class RemoteWorkerExecutor:
    """Enqueue user messages. The worker runs ``AgentRuntime`` elsewhere.

    ``idle -> running`` happens when the worker ingests ``session.status_running``,
    not in ``submit_message``. Resolutions and interrupts are already stored by
    the actor; the worker observes them on the inbox stream.
    """

    def __init__(self, actor: SessionActor, work_queue: SqliteWorkQueue) -> None:
        self._actor = actor
        self._queue = work_queue

    async def submit_message(self, message: StoredEvent) -> None:
        """Create one active work item for this session. Called with the lock held."""
        actor = self._actor
        if self._queue.active_for_session(actor.tenant_id, actor.session_id) is not None:
            return
        self._queue.create(
            tenant_id=actor.tenant_id,
            session_id=actor.session_id,
            environment_id=actor.environment.id,
            inbox_after_seq=message.seq - 1,
        )
        self._queue.notify(actor.environment.id)

    async def on_resolved(self, resolutions: Mapping[str, ClientEvent]) -> None:
        """Resolutions reach the worker through the inbox."""
        del resolutions

    async def interrupt(self, dropped_pending: Sequence[str]) -> None:
        """Interrupts reach the worker through the inbox."""
        del dropped_pending

    async def close(self) -> None:
        """Stop the active item when the session is archived or the host shuts down."""
        actor = self._actor
        item = self._queue.active_for_session(actor.tenant_id, actor.session_id)
        if item is None:
            return
        consumed = await actor.service.store.last_seq(actor.tenant_id, actor.session_id)
        self._queue.finish(
            item.tenant_id,
            item.id,
            status="stopped",
            error="session archived",
            consumed_through_seq=consumed,
        )


__all__ = [
    "RemoteWorkerExecutor",
]
