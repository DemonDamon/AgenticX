"""
AgenticX Execution Lane — Per-session Agent Run 串行化

Inspired by OpenClaw's server-lanes.ts:
- Per-session serialization: prevents race conditions on session state
- Optional global lane limit: caps total concurrent agent runs across all sessions

Source: OpenClaw src/gateway/server-lanes.ts (Apache-2.0)
"""

import asyncio
import logging
from collections import defaultdict
from typing import Optional

logger = logging.getLogger(__name__)


class ExecutionLaneGuard:
    """Async context manager that releases an execution lane on exit.

    Usage::

        lane = ExecutionLane()
        guard = await lane.acquire("session-123")
        async with guard:
            # session-123 is exclusively held here
            ...
    """

    def __init__(self, lane: "ExecutionLane", session_key: str) -> None:
        self._lane = lane
        self._session_key = session_key

    async def __aenter__(self) -> "ExecutionLaneGuard":
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:  # type: ignore[override]
        self._lane.release(self._session_key)

    @property
    def session_key(self) -> str:
        return self._session_key


class ExecutionLane:
    """Serializes agent execution per-session with an optional global concurrency cap.

    Design rationale (from OpenClaw):
    - **Per-session lock**: Two concurrent runs on the *same* session would
      race on session state / event log.  A per-session ``asyncio.Lock``
      serializes them.
    - **Global semaphore** (optional): Caps total active runs across *all*
      sessions to prevent resource exhaustion.

    Thread-safety note: This class is designed for a *single* asyncio event
    loop.  If you need cross-thread coordination, wrap with appropriate
    synchronization.

    Parameters
    ----------
    max_concurrent : int | None
        If set, limits total active executions across all sessions.
    """

    def __init__(self, max_concurrent: Optional[int] = None) -> None:
        # Use a factory so each new key auto-creates a Lock
        self._session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._global_semaphore: Optional[asyncio.Semaphore] = (
            asyncio.Semaphore(max_concurrent) if max_concurrent else None
        )
        self._max_concurrent = max_concurrent

    async def acquire(self, session_key: str) -> ExecutionLaneGuard:
        """Acquire the lane for *session_key*.

        Blocks until the per-session lock is available (and, if configured,
        a global semaphore slot is free).  Returns an
        :class:`ExecutionLaneGuard` that must be used as ``async with``.
        """
        session_lock = self._session_locks[session_key]
        await session_lock.acquire()
        logger.debug("ExecutionLane: acquired session lock for %s", session_key)

        if self._global_semaphore is not None:
            await self._global_semaphore.acquire()
            logger.debug("ExecutionLane: acquired global slot for %s", session_key)

        return ExecutionLaneGuard(self, session_key)

    def release(self, session_key: str) -> None:
        """Release the lane for *session_key*."""
        if self._global_semaphore is not None:
            self._global_semaphore.release()
            logger.debug("ExecutionLane: released global slot for %s", session_key)

        lock = self._session_locks.get(session_key)
        if lock is not None and lock.locked():
            lock.release()
            logger.debug("ExecutionLane: released session lock for %s", session_key)

    # -- introspection helpers (for tests / monitoring) -----------------------

    def is_session_locked(self, session_key: str) -> bool:
        """Return True if *session_key* currently holds the lock."""
        lock = self._session_locks.get(session_key)
        return lock.locked() if lock else False

    @property
    def active_sessions(self) -> int:
        """Number of sessions currently holding a lock."""
        return sum(1 for lock in self._session_locks.values() if lock.locked())

    @property
    def max_concurrent(self) -> Optional[int]:
        return self._max_concurrent
