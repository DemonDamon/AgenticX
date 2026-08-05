#!/usr/bin/env python3
"""Inter-process coordination contracts for HA deployments (Plan C).

The bus provides three capabilities across replicas:

- **Session locks** with lease TTL + heartbeat: the replica holding a
  session's lock owns its running turn; a holder crash releases the lock via
  TTL expiry so another replica may take over (see Plan B resume).
- **Cancel broadcast**: an interrupt requested on any replica reaches the
  replica actually running the session.
- **Bounded event replay log**: per-session runtime events with monotonic
  cursors, so SSE clients can catch up after reconnecting to a different
  replica. The log is a bounded buffer (default 1000), not event sourcing.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol, runtime_checkable


@runtime_checkable
class SessionLock(Protocol):
    """A held session lock with lease semantics."""

    owner: str

    async def renew(self) -> bool:
        """Extend the lease; False means the lock was lost."""
        ...

    async def release(self) -> None:
        """Release the lock (idempotent)."""
        ...

    async def __aenter__(self) -> "SessionLock": ...

    async def __aexit__(self, *exc: Any) -> None: ...


@runtime_checkable
class CoordinationBus(Protocol):
    """Cross-replica coordination primitives."""

    async def acquire_session_lock(
        self,
        session_id: str,
        *,
        owner: str,
        ttl_ms: int = 30000,
    ) -> SessionLock | None:
        """Try to hold the session's lock; None when another owner holds it."""
        ...

    async def publish_cancel(self, session_id: str) -> None:
        """Broadcast an interrupt request for a session to all replicas."""
        ...

    async def subscribe_cancel(
        self,
        callback: Callable[[str], Awaitable[None]],
    ) -> None:
        """Register a process-local callback for cancel broadcasts."""
        ...

    async def event_append(self, session_id: str, event: dict) -> str:
        """Append an event to the session replay log; returns its cursor."""
        ...

    async def event_read(
        self,
        session_id: str,
        *,
        since: str | None = None,
        limit: int = 1000,
    ) -> list[tuple[str, dict]]:
        """Read events with cursor strictly greater than ``since``."""
        ...

    async def event_trim(self, session_id: str, *, max_len: int = 1000) -> None:
        """Bound the session replay log to ``max_len`` entries."""
        ...

    async def ping(self) -> bool: ...
