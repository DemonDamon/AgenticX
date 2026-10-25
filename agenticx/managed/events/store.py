#!/usr/bin/env python3
"""Event store protocol shared by SQLite and future PG implementations.

Author: Damon Li
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Sequence

from agenticx.managed.protocol import SessionRecord

ENVELOPE_KEYS: frozenset[str] = frozenset(
    {"id", "session_id", "seq", "thread_id", "type", "created_at", "processed_at"}
)
ALLOWED_SESSION_UPDATE_KEYS: frozenset[str] = frozenset(
    {"status", "stop_reason", "usage", "title", "archived_at"}
)
MAX_LIST_LIMIT = 500
SESSION_VISIBLE_THREAD_TYPES: frozenset[str] = frozenset({
    "session.thread_created",
    "session.thread_status_running",
    "session.thread_status_idle",
    "session.thread_status_terminated",
})


@dataclass(frozen=True)
class ThreadFilter:
    """mode="session": thread_id IS NULL or type in SESSION_VISIBLE_THREAD_TYPES.

    mode="thread": thread_id == self.thread_id (None selects the primary thread).
    """

    mode: Literal["session", "thread"]
    thread_id: str | None = None

    def matches(self, event: StoredEvent) -> bool:
        if self.mode == "session":
            return event.thread_id is None or event.type in SESSION_VISIBLE_THREAD_TYPES
        if self.mode == "thread":
            if self.thread_id is None:
                return event.thread_id is None
            return event.thread_id == self.thread_id
        return False


@dataclass(frozen=True)
class StoredEvent:
    """One persisted session event. ``payload`` excludes envelope keys."""

    id: str
    tenant_id: str
    session_id: str
    seq: int
    type: str
    payload: Mapping[str, Any]
    created_at: str
    thread_id: str | None = None
    processed_at: str | None = None

    def to_wire(self) -> dict[str, Any]:
        """Return the SSE/history object.

        Shape: id, session_id, seq, type, payload keys, created_at, and
        thread_id/processed_at only when set. tenant_id is never exposed.
        """
        wire: dict[str, Any] = {
            "id": self.id,
            "session_id": self.session_id,
            "seq": self.seq,
            "type": self.type,
        }
        for key, value in self.payload.items():
            if key == "tenant_id" or key in wire:
                continue
            wire[key] = value
        wire["created_at"] = self.created_at
        if self.thread_id is not None:
            wire["thread_id"] = self.thread_id
        if self.processed_at is not None:
            wire["processed_at"] = self.processed_at
        return wire


class EventStore(ABC):
    """Tenant-scoped session and event persistence.

    Implementations assign a contiguous per-session ``seq`` and do not validate
    protocol payloads. ``EventLog.append`` is the validating write path.
    """

    @abstractmethod
    async def create_session(self, record: SessionRecord) -> SessionRecord:
        """Insert ``record``. Duplicate ``record.id`` raises ValueError."""

    @abstractmethod
    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        """Return the session, or None when the tenant does not own it."""

    @abstractmethod
    async def update_session(
        self,
        tenant_id: str,
        session_id: str,
        changes: Mapping[str, Any],
    ) -> SessionRecord:
        """Apply allowed column updates and refresh ``updated_at``."""

    @abstractmethod
    async def list_sessions(
        self,
        tenant_id: str,
        *,
        agent_id: str | None = None,
        created_by_user_id: str | None = None,
        limit: int = 50,
    ) -> list[SessionRecord]:
        """List sessions for one tenant, newest ``created_at`` first."""

    @abstractmethod
    async def list_unsettled_sessions(self) -> list[SessionRecord]:
        """Return cross-tenant sessions the host must recover on startup."""

    @abstractmethod
    async def append_events(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        """Atomically append events and assign the next contiguous seq values."""

    @abstractmethod
    async def list_events(
        self,
        tenant_id: str,
        session_id: str,
        *,
        after_seq: int = 0,
        limit: int = 100,
        types: Sequence[str] | None = None,
        thread_filter: ThreadFilter | None = None,
    ) -> list[StoredEvent]:
        """Return events with ``seq > after_seq`` in ascending seq order.

        ``thread_filter`` None keeps every row. Callers that omit it are unchanged.
        """

    @abstractmethod
    async def get_event(
        self,
        tenant_id: str,
        session_id: str,
        event_id: str,
    ) -> StoredEvent | None:
        """Return one event addressed by tenant, session, and id."""

    @abstractmethod
    async def mark_processed(
        self,
        tenant_id: str,
        session_id: str,
        event_ids: Sequence[str],
        processed_at: str,
    ) -> None:
        """Set ``processed_at`` on rows that are still unprocessed."""

    @abstractmethod
    async def last_seq(self, tenant_id: str, session_id: str) -> int:
        """Return the session high-water seq, or 0 when the session is absent."""

    @abstractmethod
    async def close(self) -> None:
        """Release resources. Further calls are idempotent."""
