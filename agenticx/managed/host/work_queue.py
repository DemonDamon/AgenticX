#!/usr/bin/env python3
"""SQLite work queue sharing the Managed Agents event-store connection.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, cast

from agenticx.managed.errors import INVALID_REQUEST, MAError, WORK_LEASE_LOST
from agenticx.managed.events.sqlite_store import SqliteEventStore
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import (
    WORK_LEASE_TTL_SECONDS,
    WORK_STOP_GRACE_SECONDS,
    WorkItemRecord,
    WorkItemStatus,
)

ACTIVE_STATUSES = ("queued", "claimed", "running")
LEASED_STATUSES = ("claimed", "running")
TERMINAL_STATUSES = ("completed", "failed", "stopped")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ma_work_items (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  session_id            TEXT NOT NULL REFERENCES ma_sessions(id) ON DELETE CASCADE,
  environment_id        TEXT NOT NULL,
  status                TEXT NOT NULL,
  claimed_by_device     TEXT,
  lease_expires_at      TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at     TEXT,
  inbox_after_seq       INTEGER NOT NULL DEFAULT 0,
  consumed_through_seq  INTEGER,
  error                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ma_work_env_status
  ON ma_work_items(tenant_id, environment_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_ma_work_session
  ON ma_work_items(session_id, created_at);
"""


def _text(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


@dataclass(frozen=True)
class WorkItemRow:
    """One ``ma_work_items`` row, including fields that stay off the wire."""

    id: str
    tenant_id: str
    session_id: str
    environment_id: str
    status: WorkItemStatus
    claimed_by_device: str | None
    lease_expires_at: str | None
    attempts: int
    last_heartbeat_at: str | None
    inbox_after_seq: int
    consumed_through_seq: int | None
    error: str | None
    created_at: str
    updated_at: str

    def to_record(self) -> WorkItemRecord:
        """Wire record. Extra queue columns are omitted."""
        return WorkItemRecord(
            id=self.id,
            session_id=self.session_id,
            environment_id=self.environment_id,
            status=self.status,
            claimed_by_device=self.claimed_by_device,
            lease_expires_at=self.lease_expires_at,
            attempts=self.attempts,
            last_heartbeat_at=self.last_heartbeat_at,
        )


class SqliteWorkQueue:
    """Work items stored in the same SQLite file as session events.

    Every SQL statement runs while holding ``store.lock``. Callers must not
    await while that lock is held; this class never does.
    """

    def __init__(
        self,
        store: SqliteEventStore,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._events: dict[str, asyncio.Event] = {}
        with store.lock:
            store.connection.executescript(_SCHEMA)

    def notify(self, environment_id: str) -> None:
        """Wake pollers waiting on ``environment_id``."""
        self._event_for(environment_id).set()

    async def wait_for_work(self, environment_id: str, timeout: float) -> None:
        """Wait until ``notify`` or ``timeout``. A timeout returns quietly."""
        event = self._event_for(environment_id)
        try:
            await asyncio.wait_for(event.wait(), timeout)
        except TimeoutError:
            return
        event.clear()

    def create(
        self,
        *,
        tenant_id: str,
        session_id: str,
        environment_id: str,
        inbox_after_seq: int,
    ) -> WorkItemRow:
        """Insert a queued item. The caller notifies pollers."""
        with self._store.lock:
            now = self._now()
            work_id = new_ulid()
            self._store.connection.execute(
                """
                INSERT INTO ma_work_items (
                  id, tenant_id, session_id, environment_id, status,
                  claimed_by_device, lease_expires_at, attempts,
                  last_heartbeat_at, inbox_after_seq, consumed_through_seq,
                  error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, 0, NULL, ?, NULL, NULL, ?, ?)
                """,
                (
                    work_id,
                    tenant_id,
                    session_id,
                    environment_id,
                    inbox_after_seq,
                    now,
                    now,
                ),
            )
            loaded = self._get_locked(tenant_id, work_id)
        if loaded is None:
            raise RuntimeError("work item insert failed")
        return loaded

    def get(self, tenant_id: str, work_id: str) -> WorkItemRow | None:
        with self._store.lock:
            return self._get_locked(tenant_id, work_id)

    def active_for_session(self, tenant_id: str, session_id: str) -> WorkItemRow | None:
        """Oldest queued, claimed, or running item for the session."""
        placeholders = ", ".join("?" for _ in ACTIVE_STATUSES)
        with self._store.lock:
            row = self._store.connection.execute(
                f"""
                SELECT * FROM ma_work_items
                WHERE tenant_id = ? AND session_id = ? AND status IN ({placeholders})
                ORDER BY created_at, id
                LIMIT 1
                """,
                (tenant_id, session_id, *ACTIVE_STATUSES),
            ).fetchone()
        if row is None:
            return None
        return _row_from(row)

    def claim_next(
        self,
        tenant_id: str,
        environment_id: str,
        device_id: str,
    ) -> WorkItemRow | None:
        """Claim the oldest queued item. A lost compare-and-swap returns None."""
        with self._store.lock:
            now = self._now()
            lease = self._lease_until()
            selected = self._store.connection.execute(
                """
                SELECT id FROM ma_work_items
                WHERE tenant_id = ? AND environment_id = ? AND status = 'queued'
                ORDER BY created_at, id
                LIMIT 1
                """,
                (tenant_id, environment_id),
            ).fetchone()
            if selected is None:
                return None
            work_id = str(selected["id"])
            updated = self._store.connection.execute(
                """
                UPDATE ma_work_items
                SET status = 'claimed',
                    claimed_by_device = ?,
                    lease_expires_at = ?,
                    attempts = attempts + 1,
                    last_heartbeat_at = ?,
                    updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (device_id, lease, now, now, work_id),
            )
            if updated.rowcount != 1:
                return None
            return self._get_locked(tenant_id, work_id)

    def require_lease(
        self,
        tenant_id: str,
        work_id: str,
        device_id: str,
        *,
        statuses: Sequence[str],
    ) -> WorkItemRow:
        """Return the leased row or raise ``work_lease_lost``."""
        with self._store.lock:
            return self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=statuses,
            )

    def ack(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow:
        """Move a claimed item to running and renew the lease."""
        with self._store.lock:
            self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=("claimed",),
            )
            now = self._now()
            self._store.connection.execute(
                """
                UPDATE ma_work_items
                SET status = 'running', lease_expires_at = ?, updated_at = ?
                WHERE id = ? AND tenant_id = ? AND status = 'claimed'
                """,
                (self._lease_until(), now, work_id, tenant_id),
            )
            return self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=("running",),
            )

    def heartbeat(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow:
        """Renew a claimed or running lease."""
        with self._store.lock:
            self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=LEASED_STATUSES,
            )
            now = self._now()
            self._store.connection.execute(
                """
                UPDATE ma_work_items
                SET lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?
                WHERE id = ? AND tenant_id = ?
                """,
                (self._lease_until(), now, now, work_id, tenant_id),
            )
            return self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=LEASED_STATUSES,
            )

    def complete(
        self,
        tenant_id: str,
        work_id: str,
        device_id: str,
        consumed_through_seq: int,
    ) -> WorkItemRow:
        """Finish a running item. The cursor cannot move backwards."""
        with self._store.lock:
            current = self._require_lease_locked(
                tenant_id,
                work_id,
                device_id,
                statuses=("running",),
            )
            if consumed_through_seq < current.inbox_after_seq:
                raise MAError(
                    INVALID_REQUEST,
                    "consumed_through_seq is behind inbox_after_seq",
                )
            now = self._now()
            self._store.connection.execute(
                """
                UPDATE ma_work_items
                SET status = 'completed',
                    consumed_through_seq = ?,
                    updated_at = ?
                WHERE id = ? AND tenant_id = ? AND status = 'running'
                """,
                (consumed_through_seq, now, work_id, tenant_id),
            )
            loaded = self._get_locked(tenant_id, work_id)
        if loaded is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        return loaded

    def finish(
        self,
        tenant_id: str,
        work_id: str,
        *,
        status: Literal["failed", "stopped"],
        error: str,
        consumed_through_seq: int,
    ) -> WorkItemRow:
        """Force a terminal status. Does not check the lease."""
        with self._store.lock:
            now = self._now()
            self._store.connection.execute(
                """
                UPDATE ma_work_items
                SET status = ?,
                    error = ?,
                    consumed_through_seq = ?,
                    updated_at = ?
                WHERE id = ? AND tenant_id = ?
                """,
                (status, error, consumed_through_seq, now, work_id, tenant_id),
            )
            loaded = self._get_locked(tenant_id, work_id)
        if loaded is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        return loaded

    def expired(self) -> list[WorkItemRow]:
        """Leased items whose lease ended more than the grace period ago."""
        cutoff = utc_now_iso(self._clock() - timedelta(seconds=WORK_STOP_GRACE_SECONDS))
        with self._store.lock:
            rows = self._store.connection.execute(
                """
                SELECT * FROM ma_work_items
                WHERE status IN ('claimed', 'running') AND lease_expires_at < ?
                ORDER BY created_at, id
                """,
                (cutoff,),
            ).fetchall()
        return [_row_from(row) for row in rows]

    def leased_items(self) -> list[WorkItemRow]:
        with self._store.lock:
            rows = self._store.connection.execute(
                """
                SELECT * FROM ma_work_items
                WHERE status IN ('claimed', 'running')
                ORDER BY created_at, id
                """,
            ).fetchall()
        return [_row_from(row) for row in rows]

    def _event_for(self, environment_id: str) -> asyncio.Event:
        event = self._events.get(environment_id)
        if event is None:
            event = asyncio.Event()
            self._events[environment_id] = event
        return event

    def _now(self) -> str:
        return utc_now_iso(self._clock())

    def _lease_until(self) -> str:
        return utc_now_iso(self._clock() + timedelta(seconds=WORK_LEASE_TTL_SECONDS))

    def _get_locked(self, tenant_id: str, work_id: str) -> WorkItemRow | None:
        row = self._store.connection.execute(
            """
            SELECT * FROM ma_work_items
            WHERE tenant_id = ? AND id = ?
            """,
            (tenant_id, work_id),
        ).fetchone()
        if row is None:
            return None
        return _row_from(row)

    def _require_lease_locked(
        self,
        tenant_id: str,
        work_id: str,
        device_id: str,
        *,
        statuses: Sequence[str],
    ) -> WorkItemRow:
        row = self._get_locked(tenant_id, work_id)
        now = self._now()
        lost = (
            row is None
            or row.claimed_by_device != device_id
            or row.status not in statuses
            or not row.lease_expires_at
            or row.lease_expires_at < now
        )
        if lost or row is None:
            raise MAError(
                WORK_LEASE_LOST,
                "work lease lost",
                details={"work_id": work_id},
            )
        return row


def _row_from(row: sqlite3.Row) -> WorkItemRow:
    consumed = row["consumed_through_seq"]
    return WorkItemRow(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        session_id=str(row["session_id"]),
        environment_id=str(row["environment_id"]),
        status=cast(WorkItemStatus, str(row["status"])),
        claimed_by_device=_text(row["claimed_by_device"]),
        lease_expires_at=_text(row["lease_expires_at"]),
        attempts=int(row["attempts"]),
        last_heartbeat_at=_text(row["last_heartbeat_at"]),
        inbox_after_seq=int(row["inbox_after_seq"]),
        consumed_through_seq=None if consumed is None else int(consumed),
        error=_text(row["error"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


__all__ = [
    "ACTIVE_STATUSES",
    "LEASED_STATUSES",
    "TERMINAL_STATUSES",
    "SqliteWorkQueue",
    "WorkItemRow",
]
