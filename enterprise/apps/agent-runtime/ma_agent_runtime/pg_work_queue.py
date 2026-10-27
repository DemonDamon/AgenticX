#!/usr/bin/env python3
"""PostgreSQL work queue with the same sync surface as the SQLite queue.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextvars
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, cast

from sqlalchemy import select, update
from sqlalchemy.engine import Engine

from agenticx.managed.errors import INVALID_REQUEST, MAError, WORK_LEASE_LOST
from agenticx.managed.host.work_queue import ACTIVE_STATUSES, LEASED_STATUSES, WorkItemRow
from agenticx.managed.ids import new_ulid, parse_iso, utc_now_iso
from agenticx.managed.protocol import (
    WORK_LEASE_TTL_SECONDS,
    WORK_STOP_GRACE_SECONDS,
    WorkItemStatus,
)

from ma_agent_runtime.tables import ma_sessions, ma_work_items

PG_WORK_WAIT_SLICE_SECONDS = 2.0
_ERROR_LIMIT = 500
CLAIM_CANDIDATE_LIMIT = 50


@dataclass(frozen=True)
class ClaimScope:
    """Desktop claim filter. ``allowed_agent_ids`` None means no agent filter."""

    user_id: str
    allowed_agent_ids: frozenset[str] | None = None


current_claim_scope: contextvars.ContextVar[ClaimScope | None] = contextvars.ContextVar(
    "ma_claim_scope",
    default=None,
)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return utc_now_iso(value)
    if isinstance(value, str):
        return utc_now_iso(parse_iso(value))
    return str(value)


class PgWorkQueue:
    """Short transactions against ``ma_work_items``.

    ``wait_for_work`` returns at least every two seconds so a poller notices
    rows inserted by another process.
    """

    def __init__(
        self,
        engine: Engine,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._engine = engine
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._events: dict[str, asyncio.Event] = {}

    def notify(self, environment_id: str) -> None:
        """Wake pollers waiting on ``environment_id``."""
        self._event_for(environment_id).set()

    async def wait_for_work(self, environment_id: str, timeout: float) -> None:
        """Wait until ``notify`` or one slice of ``timeout``, whichever is sooner."""
        event = self._event_for(environment_id)
        slice_timeout = min(max(timeout, 0.0), PG_WORK_WAIT_SLICE_SECONDS)
        try:
            await asyncio.wait_for(event.wait(), slice_timeout)
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
        now = self._stamp()
        work_id = new_ulid()
        with self._engine.begin() as conn:
            conn.execute(
                ma_work_items.insert().values(
                    id=work_id,
                    tenant_id=tenant_id,
                    session_id=session_id,
                    environment_id=environment_id,
                    status="queued",
                    attempts=0,
                    inbox_after_seq=inbox_after_seq,
                    created_at=now,
                    updated_at=now,
                )
            )
            loaded = self._load(conn, tenant_id, work_id)
        if loaded is None:
            raise RuntimeError("work item insert failed")
        return loaded

    def get(self, tenant_id: str, work_id: str) -> WorkItemRow | None:
        with self._engine.begin() as conn:
            return self._load(conn, tenant_id, work_id)

    def active_for_session(self, tenant_id: str, session_id: str) -> WorkItemRow | None:
        """Oldest queued, claimed, or running item for the session."""
        stmt = (
            select(ma_work_items)
            .where(
                ma_work_items.c.tenant_id == tenant_id,
                ma_work_items.c.session_id == session_id,
                ma_work_items.c.status.in_(ACTIVE_STATUSES),
            )
            .order_by(ma_work_items.c.created_at, ma_work_items.c.id)
            .limit(1)
        )
        with self._engine.begin() as conn:
            row = conn.execute(stmt).mappings().first()
        if row is None:
            return None
        return _row_from(row)

    def queued_agent_ids(self, tenant_id: str, environment_id: str) -> set[str]:
        """Distinct agent ids with a queued item in this environment."""
        stmt = (
            select(ma_sessions.c.agent_id)
            .select_from(
                ma_work_items.join(
                    ma_sessions,
                    ma_sessions.c.id == ma_work_items.c.session_id,
                )
            )
            .where(
                ma_work_items.c.tenant_id == tenant_id,
                ma_work_items.c.environment_id == environment_id,
                ma_work_items.c.status == "queued",
            )
            .distinct()
        )
        with self._engine.begin() as conn:
            rows = conn.execute(stmt).all()
        return {str(row[0]) for row in rows if row[0] is not None}

    def claim_next(
        self,
        tenant_id: str,
        environment_id: str,
        device_id: str,
    ) -> WorkItemRow | None:
        """Claim the oldest queued item. A lost compare-and-swap returns None."""
        scope = current_claim_scope.get()
        if scope is not None:
            with self._engine.begin() as conn:
                return self._claim_scoped(conn, tenant_id, environment_id, device_id, scope)
        now = self._stamp()
        lease = self._lease_until()
        with self._engine.begin() as conn:
            stmt = (
                select(ma_work_items.c.id)
                .where(
                    ma_work_items.c.tenant_id == tenant_id,
                    ma_work_items.c.environment_id == environment_id,
                    ma_work_items.c.status == "queued",
                )
                .order_by(ma_work_items.c.created_at, ma_work_items.c.id)
                .limit(1)
            )
            if conn.dialect.name == "postgresql":
                stmt = stmt.with_for_update(skip_locked=True)
            selected = conn.execute(stmt).first()
            if selected is None:
                return None
            work_id = str(selected.id)
            updated = conn.execute(
                update(ma_work_items)
                .where(ma_work_items.c.id == work_id, ma_work_items.c.status == "queued")
                .values(
                    status="claimed",
                    claimed_by_device=device_id,
                    claimed_at=now,
                    lease_expires_at=lease,
                    attempts=ma_work_items.c.attempts + 1,
                    last_heartbeat_at=now,
                    updated_at=now,
                )
            )
            if int(updated.rowcount or 0) != 1:
                return None
            return self._load(conn, tenant_id, work_id)

    def require_lease(
        self,
        tenant_id: str,
        work_id: str,
        device_id: str,
        *,
        statuses: Sequence[str],
    ) -> WorkItemRow:
        """Return the leased row or raise ``work_lease_lost``."""
        with self._engine.begin() as conn:
            return self._require(conn, tenant_id, work_id, device_id, statuses=statuses)

    def ack(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow:
        """Move a claimed item to running and renew the lease."""
        now = self._stamp()
        with self._engine.begin() as conn:
            self._require(conn, tenant_id, work_id, device_id, statuses=("claimed",))
            conn.execute(
                update(ma_work_items)
                .where(
                    ma_work_items.c.id == work_id,
                    ma_work_items.c.tenant_id == tenant_id,
                    ma_work_items.c.status == "claimed",
                )
                .values(status="running", lease_expires_at=self._lease_until(), updated_at=now)
            )
            return self._require(conn, tenant_id, work_id, device_id, statuses=("running",))

    def heartbeat(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow:
        """Renew a claimed or running lease."""
        now = self._stamp()
        with self._engine.begin() as conn:
            self._require(conn, tenant_id, work_id, device_id, statuses=LEASED_STATUSES)
            conn.execute(
                update(ma_work_items)
                .where(ma_work_items.c.id == work_id, ma_work_items.c.tenant_id == tenant_id)
                .values(
                    lease_expires_at=self._lease_until(),
                    last_heartbeat_at=now,
                    updated_at=now,
                )
            )
            return self._require(conn, tenant_id, work_id, device_id, statuses=LEASED_STATUSES)

    def complete(
        self,
        tenant_id: str,
        work_id: str,
        device_id: str,
        consumed_through_seq: int,
    ) -> WorkItemRow:
        """Finish a running item. The cursor cannot move backwards."""
        now = self._stamp()
        with self._engine.begin() as conn:
            current = self._require(conn, tenant_id, work_id, device_id, statuses=("running",))
            if consumed_through_seq < current.inbox_after_seq:
                raise MAError(INVALID_REQUEST, "consumed_through_seq is behind inbox_after_seq")
            conn.execute(
                update(ma_work_items)
                .where(
                    ma_work_items.c.id == work_id,
                    ma_work_items.c.tenant_id == tenant_id,
                    ma_work_items.c.status == "running",
                )
                .values(
                    status="completed",
                    consumed_through_seq=consumed_through_seq,
                    completed_at=now,
                    updated_at=now,
                )
            )
            loaded = self._load(conn, tenant_id, work_id)
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
        now = self._stamp()
        with self._engine.begin() as conn:
            conn.execute(
                update(ma_work_items)
                .where(ma_work_items.c.id == work_id, ma_work_items.c.tenant_id == tenant_id)
                .values(
                    status=status,
                    error=error[:_ERROR_LIMIT],
                    consumed_through_seq=consumed_through_seq,
                    completed_at=now,
                    updated_at=now,
                )
            )
            loaded = self._load(conn, tenant_id, work_id)
        if loaded is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        return loaded

    def expired(self) -> list[WorkItemRow]:
        """Leased items whose lease ended more than the grace period ago."""
        cutoff = utc_now_iso(self._clock() - timedelta(seconds=WORK_STOP_GRACE_SECONDS))
        return [
            item
            for item in self.leased_items()
            if item.lease_expires_at is not None and item.lease_expires_at < cutoff
        ]

    def leased_items(self) -> list[WorkItemRow]:
        stmt = (
            select(ma_work_items)
            .where(ma_work_items.c.status.in_(LEASED_STATUSES))
            .order_by(ma_work_items.c.created_at, ma_work_items.c.id)
        )
        with self._engine.begin() as conn:
            rows = conn.execute(stmt).mappings().all()
        return [_row_from(row) for row in rows]

    def _event_for(self, environment_id: str) -> asyncio.Event:
        event = self._events.get(environment_id)
        if event is None:
            event = asyncio.Event()
            self._events[environment_id] = event
        return event

    def _stamp(self) -> datetime:
        current = self._clock()
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        return parse_iso(utc_now_iso(current))

    def _lease_until(self) -> datetime:
        return parse_iso(utc_now_iso(self._clock() + timedelta(seconds=WORK_LEASE_TTL_SECONDS)))

    def _load(self, conn: Any, tenant_id: str, work_id: str) -> WorkItemRow | None:
        row = (
            conn.execute(
                select(ma_work_items).where(
                    ma_work_items.c.tenant_id == tenant_id,
                    ma_work_items.c.id == work_id,
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        return _row_from(row)

    def _require(
        self,
        conn: Any,
        tenant_id: str,
        work_id: str,
        device_id: str,
        *,
        statuses: Sequence[str],
    ) -> WorkItemRow:
        row = self._load(conn, tenant_id, work_id)
        now = utc_now_iso(self._stamp())
        lost = (
            row is None
            or row.claimed_by_device != device_id
            or row.status not in statuses
            or not row.lease_expires_at
            or row.lease_expires_at < now
        )
        if lost or row is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        scope = current_claim_scope.get()
        if scope is not None and (self._claimed_user_id(conn, tenant_id, work_id) or "") != scope.user_id:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        return row

    def _claimed_user_id(self, conn: Any, tenant_id: str, work_id: str) -> str | None:
        value = conn.execute(
            select(ma_work_items.c.claimed_by_user_id).where(
                ma_work_items.c.tenant_id == tenant_id,
                ma_work_items.c.id == work_id,
            )
        ).scalar_one_or_none()
        if value is None:
            return None
        return str(value)

    def _claim_scoped(
        self,
        conn: Any,
        tenant_id: str,
        environment_id: str,
        device_id: str,
        scope: ClaimScope,
    ) -> WorkItemRow | None:
        """Claim the oldest queued item the desktop scope allows, and record the user."""
        now = self._stamp()
        lease = self._lease_until()
        stmt = (
            select(
                ma_work_items.c.id,
                ma_sessions.c.agent_id,
                ma_sessions.c.source,
                ma_sessions.c.created_by_user_id,
            )
            .select_from(
                ma_work_items.join(
                    ma_sessions,
                    ma_sessions.c.id == ma_work_items.c.session_id,
                )
            )
            .where(
                ma_work_items.c.tenant_id == tenant_id,
                ma_work_items.c.environment_id == environment_id,
                ma_work_items.c.status == "queued",
            )
            .order_by(ma_work_items.c.created_at, ma_work_items.c.id)
            .limit(CLAIM_CANDIDATE_LIMIT)
        )
        if conn.dialect.name == "postgresql":
            stmt = stmt.with_for_update(of=ma_work_items, skip_locked=True)
        chosen: str | None = None
        for row in conn.execute(stmt).mappings().all():
            agent_id = str(row["agent_id"] or "")
            if scope.allowed_agent_ids is not None and agent_id not in scope.allowed_agent_ids:
                continue
            source = str(row["source"] or "")
            owner = str(row["created_by_user_id"] or "")
            if source == "desktop" and owner != scope.user_id:
                continue
            chosen = str(row["id"])
            break
        if chosen is None:
            return None
        updated = conn.execute(
            update(ma_work_items)
            .where(ma_work_items.c.id == chosen, ma_work_items.c.status == "queued")
            .values(
                status="claimed",
                claimed_by_device=device_id,
                claimed_by_user_id=scope.user_id,
                claimed_at=now,
                lease_expires_at=lease,
                attempts=ma_work_items.c.attempts + 1,
                last_heartbeat_at=now,
                updated_at=now,
            )
        )
        if int(updated.rowcount or 0) != 1:
            return None
        return self._load(conn, tenant_id, chosen)


def _row_from(row: Any) -> WorkItemRow:
    consumed = row["consumed_through_seq"]
    status = str(row["status"])
    return WorkItemRow(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        session_id=str(row["session_id"]),
        environment_id=str(row["environment_id"]),
        status=_status(status),
        claimed_by_device=None if row["claimed_by_device"] is None else str(row["claimed_by_device"]),
        lease_expires_at=_iso(row["lease_expires_at"]),
        attempts=int(row["attempts"]),
        last_heartbeat_at=_iso(row["last_heartbeat_at"]),
        inbox_after_seq=int(row["inbox_after_seq"]),
        consumed_through_seq=None if consumed is None else int(consumed),
        error=None if row["error"] is None else str(row["error"]),
        created_at=_iso(row["created_at"]) or "",
        updated_at=_iso(row["updated_at"]) or "",
    )


def _status(value: str) -> WorkItemStatus:
    return cast(WorkItemStatus, value)


__all__ = [
    "CLAIM_CANDIDATE_LIMIT",
    "ClaimScope",
    "PG_WORK_WAIT_SLICE_SECONDS",
    "PgWorkQueue",
    "current_claim_scope",
]
