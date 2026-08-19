"""Process-local admission control for top-level Studio turns.

The limiter deliberately counts user-visible turns, not individual model or
tool calls.  It also reserves a session while it is active or queued so two
writers can never mutate the same ``StudioSession`` concurrently.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import AsyncIterator, Deque, TypeVar


DEFAULT_MAX_ACTIVE = 3
DEFAULT_MAX_WAITERS = 24
DEFAULT_WAIT_TIMEOUT_SECONDS = 300.0
_StreamItem = TypeVar("_StreamItem")


class SessionTurnBusy(RuntimeError):
    """Raised when the same session already has an active or queued turn."""


class TurnQueueFull(RuntimeError):
    """Raised when the bounded wait queue has no remaining capacity."""


class TurnQueueTimeout(RuntimeError):
    """Raised when a turn could not enter before its queue deadline."""


@dataclass(slots=True)
class _Waiter:
    session_id: str
    source: str
    future: asyncio.Future[str]
    granted_lease_id: str | None = None


@dataclass(slots=True)
class TurnLease:
    """One admission token.  ``release`` is safe to call more than once."""

    session_id: str
    source: str
    lease_id: str
    _limiter: "TurnLimiter" = field(repr=False)
    _released: bool = field(default=False, init=False, repr=False)

    async def release(self) -> None:
        if self._released:
            return
        await self._limiter._release(self.session_id, self.lease_id)
        self._released = True


def _bounded_env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = str(os.environ.get(name, "") or "").strip()
    try:
        value = int(raw) if raw else default
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _bounded_env_float(
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    raw = str(os.environ.get(name, "") or "").strip()
    try:
        value = float(raw) if raw else default
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


class TurnLimiter:
    """FIFO, bounded admission controller with per-session single-flight."""

    def __init__(
        self,
        *,
        max_active: int = DEFAULT_MAX_ACTIVE,
        max_waiters: int = DEFAULT_MAX_WAITERS,
        wait_timeout_seconds: float = DEFAULT_WAIT_TIMEOUT_SECONDS,
    ) -> None:
        self.max_active = max(1, int(max_active))
        self.max_waiters = max(0, int(max_waiters))
        self.wait_timeout_seconds = max(0.001, float(wait_timeout_seconds))
        self._lock = asyncio.Lock()
        self._active: dict[str, str] = {}
        self._waiting_sessions: set[str] = set()
        self._waiters: Deque[_Waiter] = deque()

    @classmethod
    def from_env(cls) -> "TurnLimiter":
        return cls(
            max_active=_bounded_env_int(
                "AGX_DESKTOP_MAX_CONCURRENT_TURNS",
                DEFAULT_MAX_ACTIVE,
                minimum=1,
                maximum=16,
            ),
            max_waiters=_bounded_env_int(
                "AGX_DESKTOP_MAX_QUEUED_TURNS",
                DEFAULT_MAX_WAITERS,
                minimum=0,
                maximum=256,
            ),
            wait_timeout_seconds=_bounded_env_float(
                "AGX_DESKTOP_TURN_QUEUE_TIMEOUT_SECONDS",
                DEFAULT_WAIT_TIMEOUT_SECONDS,
                minimum=1.0,
                maximum=3600.0,
            ),
        )

    @property
    def active_count(self) -> int:
        return len(self._active)

    @property
    def waiting_count(self) -> int:
        return len(self._waiters)

    async def acquire(self, session_id: str, *, source: str) -> TurnLease:
        sid = str(session_id or "").strip()
        if not sid:
            raise ValueError("session_id is required")
        source_name = str(source or "unknown").strip() or "unknown"
        loop = asyncio.get_running_loop()
        waiter: _Waiter | None = None

        async with self._lock:
            if sid in self._active or sid in self._waiting_sessions:
                raise SessionTurnBusy(f"session already has a turn: {sid}")
            if len(self._active) < self.max_active:
                lease_id = uuid.uuid4().hex
                self._active[sid] = lease_id
                return TurnLease(sid, source_name, lease_id, self)
            if self.max_waiters == 0 or len(self._waiters) >= self.max_waiters:
                raise TurnQueueFull("turn wait queue is full")
            waiter = _Waiter(sid, source_name, loop.create_future())
            self._waiters.append(waiter)
            self._waiting_sessions.add(sid)

        try:
            lease_id = await asyncio.wait_for(
                asyncio.shield(waiter.future),
                timeout=self.wait_timeout_seconds,
            )
            return TurnLease(sid, source_name, lease_id, self)
        except asyncio.TimeoutError as exc:
            await self._withdraw_waiter(waiter)
            raise TurnQueueTimeout("timed out waiting for a turn slot") from exc
        except asyncio.CancelledError:
            await self._withdraw_waiter(waiter)
            raise

    async def _withdraw_waiter(self, waiter: _Waiter) -> None:
        async with self._lock:
            if waiter.granted_lease_id is not None:
                current = self._active.get(waiter.session_id)
                if current == waiter.granted_lease_id:
                    del self._active[waiter.session_id]
                    self._grant_waiters_locked()
                return
            try:
                self._waiters.remove(waiter)
            except ValueError:
                pass
            self._waiting_sessions.discard(waiter.session_id)
            if not waiter.future.done():
                waiter.future.cancel()

    async def _release(self, session_id: str, lease_id: str) -> None:
        async with self._lock:
            if self._active.get(session_id) != lease_id:
                return
            del self._active[session_id]
            self._grant_waiters_locked()

    def _grant_waiters_locked(self) -> None:
        while self._waiters and len(self._active) < self.max_active:
            waiter = self._waiters.popleft()
            self._waiting_sessions.discard(waiter.session_id)
            if waiter.future.cancelled():
                continue
            lease_id = uuid.uuid4().hex
            waiter.granted_lease_id = lease_id
            self._active[waiter.session_id] = lease_id
            if not waiter.future.done():
                waiter.future.set_result(lease_id)


async def stream_with_turn_lease(
    stream: AsyncIterator[_StreamItem],
    lease: TurnLease,
) -> AsyncIterator[_StreamItem]:
    """Keep a lease until a streaming response ends, errors, or is cancelled."""

    try:
        async for item in stream:
            yield item
    finally:
        await lease.release()


__all__ = [
    "SessionTurnBusy",
    "TurnLease",
    "TurnLimiter",
    "TurnQueueFull",
    "TurnQueueTimeout",
    "stream_with_turn_lease",
]
