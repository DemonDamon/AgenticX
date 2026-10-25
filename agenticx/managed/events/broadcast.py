#!/usr/bin/env python3
"""In-process event broadcast and the validate-persist-publish write path.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence

from pydantic import ValidationError

from agenticx.managed.errors import ALL_ERROR_CODES, INVALID_EVENT_BATCH, MAError
from agenticx.managed.events.store import EventStore, StoredEvent
from agenticx.managed.protocol import (
    CLIENT_EVENT_TYPES,
    SERVER_EVENT_TYPES,
    parse_client_events,
    parse_server_event,
)

DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE = 1000

_ERROR_BY_CODE = {item.code: item for item in ALL_ERROR_CODES}


@dataclass(frozen=True)
class BroadcastItem:
    """One item delivered to a session subscriber."""

    kind: Literal["event", "preview", "close"]
    event: StoredEvent | None = None
    frame: Mapping[str, Any] | None = None


@dataclass
class Subscription:
    """A single SSE consumer queue for one session."""

    session_id: str
    queue: asyncio.Queue[BroadcastItem]
    overflowed: bool = False
    closed: bool = False
    _owner: EventBroadcaster | None = field(default=None, repr=False)

    def close(self) -> None:
        """Idempotent unsubscribe."""
        if self._owner is None:
            self.closed = True
            return
        owner = self._owner
        self.closed = True
        self._owner = None
        owner._forget(self)


class EventBroadcaster:
    """Fan out persisted events and non-durable preview frames.

    ``subscribe`` must run inside a running event loop. A full subscriber queue
    marks that subscriber overflowed and drops it; the publisher never blocks.
    """

    def __init__(self, *, queue_maxsize: int = DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE) -> None:
        self._queue_maxsize = queue_maxsize
        self._subs: dict[str, list[Subscription]] = {}

    def subscribe(self, session_id: str) -> Subscription:
        queue: asyncio.Queue[BroadcastItem] = asyncio.Queue(maxsize=self._queue_maxsize)
        sub = Subscription(session_id=session_id, queue=queue, _owner=self)
        self._subs.setdefault(session_id, []).append(sub)
        return sub

    def publish_events(self, session_id: str, events: Sequence[StoredEvent]) -> None:
        subs = list(self._subs.get(session_id, ()))
        for event in events:
            item = BroadcastItem(kind="event", event=event)
            for sub in subs:
                self._offer(sub, item)

    def publish_preview(self, session_id: str, frame: Mapping[str, Any]) -> None:
        item = BroadcastItem(kind="preview", frame=dict(frame))
        for sub in list(self._subs.get(session_id, ())):
            self._offer(sub, item)

    def close_session(self, session_id: str) -> None:
        subs = list(self._subs.get(session_id, ()))
        self._subs.pop(session_id, None)
        for sub in subs:
            if not sub.closed:
                try:
                    sub.queue.put_nowait(BroadcastItem(kind="close"))
                except asyncio.QueueFull:
                    sub.overflowed = True
            sub.closed = True
            sub._owner = None

    def subscriber_count(self, session_id: str) -> int:
        return len(self._subs.get(session_id, ()))

    def _offer(self, sub: Subscription, item: BroadcastItem) -> None:
        if sub.closed:
            return
        try:
            sub.queue.put_nowait(item)
        except asyncio.QueueFull:
            sub.overflowed = True
            sub.closed = True
            sub._owner = None
            self._forget(sub)

    def _forget(self, sub: Subscription) -> None:
        current = self._subs.get(sub.session_id)
        if not current:
            return
        remaining = [item for item in current if item is not sub]
        if remaining:
            self._subs[sub.session_id] = remaining
        else:
            self._subs.pop(sub.session_id, None)


class EventLog:
    """Validate, persist, then broadcast. The only write path used by MA-A04/MA-A05."""

    def __init__(self, store: EventStore, broadcaster: EventBroadcaster) -> None:
        self._store = store
        self._broadcaster = broadcaster

    @property
    def store(self) -> EventStore:
        return self._store

    @property
    def broadcaster(self) -> EventBroadcaster:
        return self._broadcaster

    async def append(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        for index, event in enumerate(events):
            _validate_event(index, event)
        stored = await self._store.append_events(tenant_id, session_id, events)
        self._broadcaster.publish_events(session_id, stored)
        return stored

    def publish_preview(self, session_id: str, frame: Mapping[str, Any]) -> None:
        self._broadcaster.publish_preview(session_id, frame)


def _validate_event(index: int, event: Mapping[str, Any]) -> None:
    event_type = event.get("type")
    body = dict(event)
    if event_type in SERVER_EVENT_TYPES:
        try:
            parse_server_event(body)
        except (ValidationError, MAError):
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: invalid",
                details={"index": index},
            ) from None
        return
    if event_type in CLIENT_EVENT_TYPES:
        try:
            parse_client_events({"events": [body]})
        except MAError as exc:
            details = dict(exc.details)
            details["index"] = index
            code = _ERROR_BY_CODE.get(exc.code, INVALID_EVENT_BATCH)
            message = exc.message.replace("events[0]", f"events[{index}]", 1)
            raise MAError(code, message, details=details) from None
        return
    raise MAError(
        INVALID_EVENT_BATCH,
        f"events[{index}]: unknown event type",
        details={"index": index},
    )
