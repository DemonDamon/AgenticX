#!/usr/bin/env python3
"""In-process coordination bus (default; single-replica semantics).

Behavioral invariants vs pre-HA builds:

- session locks are always granted (intra-process concurrency is already
  handled by the existing duplicate-turn guard and continuation lock), so
  chat behavior is unchanged;
- cancel broadcast invokes process-local callbacks directly;
- the event replay log is a bounded in-memory deque per session.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import itertools
import logging
from collections import deque
from typing import Any, Awaitable, Callable, Dict

logger = logging.getLogger(__name__)

_EVENT_LOG_MAXLEN = 1000


class InProcessSessionLock:
    """No-op lock: always held by this process."""

    def __init__(self, session_id: str, owner: str) -> None:
        self.session_id = session_id
        self.owner = owner

    async def renew(self) -> bool:
        return True

    async def release(self) -> None:
        return None

    async def __aenter__(self) -> "InProcessSessionLock":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.release()


class InProcessBus:
    """``CoordinationBus`` implementation confined to this process."""

    def __init__(self) -> None:
        self._cancel_callbacks: list[Callable[[str], Awaitable[None]]] = []
        self._event_logs: Dict[str, deque] = {}
        self._event_seqs: Dict[str, itertools.count] = {}
        self._event_lock = asyncio.Lock()

    async def acquire_session_lock(
        self,
        session_id: str,
        *,
        owner: str,
        ttl_ms: int = 30000,
    ) -> InProcessSessionLock | None:
        del ttl_ms  # no lease in a single process
        return InProcessSessionLock(session_id, owner)

    async def publish_cancel(self, session_id: str) -> None:
        for callback in list(self._cancel_callbacks):
            try:
                await callback(session_id)
            except Exception:
                logger.warning("cancel callback failed", exc_info=True)

    async def subscribe_cancel(
        self,
        callback: Callable[[str], Awaitable[None]],
    ) -> None:
        self._cancel_callbacks.append(callback)

    async def event_append(self, session_id: str, event: dict) -> str:
        async with self._event_lock:
            seqs = self._event_seqs.setdefault(session_id, itertools.count(1))
            cursor = str(next(seqs))
            log = self._event_logs.setdefault(session_id, deque(maxlen=_EVENT_LOG_MAXLEN))
            log.append((cursor, event))
            return cursor

    async def event_read(
        self,
        session_id: str,
        *,
        since: str | None = None,
        limit: int = 1000,
    ) -> list[tuple[str, dict]]:
        log = self._event_logs.get(session_id)
        if not log:
            return []
        try:
            since_seq = int(since) if since else 0
        except (TypeError, ValueError):
            since_seq = 0
        rows = [(cursor, event) for cursor, event in log if int(cursor) > since_seq]
        return rows[: max(1, int(limit))]

    async def event_trim(self, session_id: str, *, max_len: int = 1000) -> None:
        log = self._event_logs.get(session_id)
        if log is None:
            return
        while len(log) > max(1, int(max_len)):
            log.popleft()

    async def ping(self) -> bool:
        return True
