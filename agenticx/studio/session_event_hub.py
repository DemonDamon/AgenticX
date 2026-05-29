#!/usr/bin/env python3
"""Per-session SSE event hub: pub-sub + ring-buffer replay for live reattach.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agenticx.runtime.events import RuntimeEvent

_log = logging.getLogger(__name__)

DEFAULT_BUFFER_MAXLEN = 400
DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE = 256
MAX_SUBSCRIBERS = 8


@dataclass(frozen=True)
class BufferedEvent:
    """One sequenced runtime event, or ``event=None`` when the run loop finished."""

    seq: int
    event: RuntimeEvent | None


class SessionEventHub:
    """In-memory pub-sub hub for a single chat session's runtime SSE events."""

    def __init__(
        self,
        session_id: str,
        *,
        buffer_maxlen: int = DEFAULT_BUFFER_MAXLEN,
        subscriber_queue_maxsize: int = DEFAULT_SUBSCRIBER_QUEUE_MAXSIZE,
    ) -> None:
        self.session_id = session_id
        self._buffer_maxlen = max(16, int(buffer_maxlen))
        self._subscriber_queue_maxsize = max(8, int(subscriber_queue_maxsize))
        self._seq = 0
        self._buffer: deque[BufferedEvent] = deque(maxlen=self._buffer_maxlen)
        self._subscribers: dict[int, asyncio.Queue[BufferedEvent]] = {}
        self._next_sub_id = 0
        self._lock = asyncio.Lock()
        self._closed = False
        self._runtime_done = False

    @property
    def current_seq(self) -> int:
        return self._seq

    @property
    def is_runtime_done(self) -> bool:
        return self._runtime_done

    @property
    def is_closed(self) -> bool:
        return self._closed

    @property
    def is_active(self) -> bool:
        return not self._closed and not self._runtime_done

    async def publish(self, event: RuntimeEvent) -> int:
        """Publish a runtime event; returns the assigned monotonic seq."""
        async with self._lock:
            if self._closed or self._runtime_done:
                return self._seq
            self._seq += 1
            seq = self._seq
            buffered = BufferedEvent(seq=seq, event=event)
            self._buffer.append(buffered)
            self._fanout_locked(buffered)
            return seq

    async def publish_done(self) -> int:
        """Signal that the runtime producer finished (sentinel for subscribers)."""
        async with self._lock:
            if self._closed or self._runtime_done:
                return self._seq
            self._runtime_done = True
            self._seq += 1
            seq = self._seq
            buffered = BufferedEvent(seq=seq, event=None)
            self._buffer.append(buffered)
            self._fanout_locked(buffered)
            return seq

    def _fanout_locked(self, buffered: BufferedEvent) -> None:
        dead: list[int] = []
        for sub_id, q in self._subscribers.items():
            try:
                q.put_nowait(buffered)
            except asyncio.QueueFull:
                _log.warning(
                    "[event_hub] dropping slow subscriber sub=%s session=%s",
                    sub_id,
                    self.session_id,
                )
                dead.append(sub_id)
        for sub_id in dead:
            self._subscribers.pop(sub_id, None)

    def subscribe(self) -> tuple[int, asyncio.Queue[BufferedEvent], int]:
        """Subscribe to live events. Returns (subscriber_id, queue, current_seq)."""
        if self._closed:
            raise RuntimeError("event hub is closed")
        if len(self._subscribers) >= MAX_SUBSCRIBERS:
            raise RuntimeError("too many subscribers for session event hub")
        sub_id = self._next_sub_id
        self._next_sub_id += 1
        q: asyncio.Queue[BufferedEvent] = asyncio.Queue(maxsize=self._subscriber_queue_maxsize)
        self._subscribers[sub_id] = q
        return sub_id, q, self._seq

    def unsubscribe(self, sub_id: int) -> None:
        self._subscribers.pop(sub_id, None)

    def replay_since(self, since_seq: int) -> list[BufferedEvent]:
        """Return buffered events with seq strictly greater than *since_seq*."""
        try:
            since = int(since_seq)
        except (TypeError, ValueError):
            since = 0
        return [b for b in self._buffer if b.seq > since]

    def oldest_buffered_seq(self) -> int | None:
        if not self._buffer:
            return None
        return self._buffer[0].seq

    def close(self) -> None:
        self._closed = True
        self._subscribers.clear()
        self._buffer.clear()
