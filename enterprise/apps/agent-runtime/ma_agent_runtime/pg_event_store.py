#!/usr/bin/env python3
"""PostgreSQL (and test SQLite) EventStore for managed sessions.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from pydantic import ValidationError
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.sql import Insert

from agenticx.managed.errors import INVALID_EVENT_BATCH, MAError, SESSION_NOT_FOUND
from agenticx.managed.events.store import (
    ALLOWED_SESSION_UPDATE_KEYS,
    ENVELOPE_KEYS,
    MAX_LIST_LIMIT,
    SESSION_VISIBLE_THREAD_TYPES,
    EventStore,
    StoredEvent,
    ThreadFilter,
)
from agenticx.managed.ids import is_ulid, new_ulid, parse_iso, utc_now_iso
from agenticx.managed.protocol import SessionRecord, StopReason, Usage

from ma_agent_runtime.tables import ma_session_events, ma_session_usage, ma_sessions

_USAGE_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "tool_calls",
    "runtime_ms",
)


def _insert_ignore(dialect: str, table: Any, conflict_cols: tuple[str, ...]) -> Insert:
    """INSERT that ignores unique conflicts on ``conflict_cols``."""
    columns = list(conflict_cols)
    if dialect == "postgresql":
        return pg_insert(table).on_conflict_do_nothing(index_elements=columns)
    if dialect == "sqlite":
        return sqlite_insert(table).on_conflict_do_nothing(index_elements=columns)
    raise NotImplementedError(dialect)


def _clamp_limit(limit: int) -> int:
    if limit < 1:
        return 1
    if limit > MAX_LIST_LIMIT:
        return MAX_LIST_LIMIT
    return limit


def _as_mapping(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, str):
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else {}
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        loaded = json.loads(value)
        return loaded if isinstance(loaded, list) else []
    if isinstance(value, list):
        return value
    return []


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return utc_now_iso(value)
    if isinstance(value, str):
        return utc_now_iso(parse_iso(value))
    raise TypeError(f"unsupported timestamp {type(value)!r}")


def _optional_str(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


class PgEventStore(EventStore):
    """EventStore backed by SQLAlchemy Core.

    PostgreSQL serializes ``append_events`` with ``UPDATE ... RETURNING``.
    SQLite writes take a process-local asyncio lock because the test dialect
    has no row lock.
    """

    def __init__(
        self,
        engine: AsyncEngine,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._engine = engine
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._sqlite_write_lock = asyncio.Lock()
        self._closed = False

    @asynccontextmanager
    async def _write_guard(self) -> AsyncIterator[None]:
        if self._engine.dialect.name == "sqlite":
            async with self._sqlite_write_lock:
                yield
        else:
            yield

    def _now(self) -> datetime:
        current = self._clock()
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        return parse_iso(utc_now_iso(current))

    async def create_session(self, record: SessionRecord) -> SessionRecord:
        async with self._write_guard():
            async with self._engine.begin() as conn:
                existing = (
                    await conn.execute(select(ma_sessions.c.id).where(ma_sessions.c.id == record.id))
                ).first()
                if existing is not None:
                    raise ValueError("session already exists")
                dumped = record.model_dump(mode="json")
                try:
                    await conn.execute(
                        ma_sessions.insert().values(
                            id=dumped["id"],
                            tenant_id=dumped["tenant_id"],
                            agent_id=dumped["agent_id"],
                            agent_version=dumped["agent_version"],
                            environment_id=dumped.get("environment_id"),
                            created_by_user_id=dumped.get("created_by_user_id"),
                            source=dumped["source"],
                            status=dumped["status"],
                            stop_reason=dumped.get("stop_reason"),
                            title=dumped.get("title"),
                            vault_ids=dumped.get("vault_ids") or [],
                            resources=dumped.get("resources") or [],
                            usage_totals=dumped.get("usage") or {},
                            last_seq=0,
                            created_at=parse_iso(dumped["created_at"]),
                            updated_at=parse_iso(dumped["updated_at"]),
                            archived_at=(
                                parse_iso(dumped["archived_at"]) if dumped.get("archived_at") else None
                            ),
                        )
                    )
                except IntegrityError as exc:
                    raise ValueError("session already exists") from exc
                loaded = await self._load_session(conn, record.tenant_id, record.id)
        if loaded is None:
            raise RuntimeError("inserted session could not be reloaded")
        return loaded

    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        async with self._engine.connect() as conn:
            return await self._load_session(conn, tenant_id, session_id)

    async def update_session(
        self,
        tenant_id: str,
        session_id: str,
        changes: Mapping[str, Any],
    ) -> SessionRecord:
        extra = set(changes) - ALLOWED_SESSION_UPDATE_KEYS
        if extra:
            raise ValueError(f"unsupported session fields: {sorted(extra)}")
        values = _update_values(changes)
        values["updated_at"] = self._now()
        async with self._write_guard():
            async with self._engine.begin() as conn:
                result = await conn.execute(
                    update(ma_sessions)
                    .where(ma_sessions.c.id == session_id, ma_sessions.c.tenant_id == tenant_id)
                    .values(**values)
                )
                if _rowcount(result) == 0:
                    raise MAError(SESSION_NOT_FOUND, "session not found")
                loaded = await self._load_session(conn, tenant_id, session_id)
        if loaded is None:
            raise MAError(SESSION_NOT_FOUND, "session not found")
        return loaded

    async def list_sessions(
        self,
        tenant_id: str,
        *,
        agent_id: str | None = None,
        created_by_user_id: str | None = None,
        limit: int = 50,
    ) -> list[SessionRecord]:
        stmt = select(ma_sessions).where(ma_sessions.c.tenant_id == tenant_id)
        if agent_id is not None:
            stmt = stmt.where(ma_sessions.c.agent_id == agent_id)
        if created_by_user_id is not None:
            stmt = stmt.where(ma_sessions.c.created_by_user_id == created_by_user_id)
        stmt = stmt.order_by(ma_sessions.c.created_at.desc(), ma_sessions.c.id.desc()).limit(
            _clamp_limit(limit)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(stmt)).mappings().all()
        return [_row_to_session(row) for row in rows]

    async def list_unsettled_sessions(self) -> list[SessionRecord]:
        stop_type = ma_sessions.c.stop_reason["type"].as_string()
        stmt = select(ma_sessions).where(
            or_(
                ma_sessions.c.status.in_(("running", "rescheduling")),
                and_(ma_sessions.c.status == "idle", stop_type == "requires_action"),
            )
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(stmt)).mappings().all()
        return [_row_to_session(row) for row in rows]

    async def append_events(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        if not events:
            return []
        ids = _validated_ids(events)
        now = self._now()
        count = len(events)
        try:
            async with self._write_guard():
                async with self._engine.begin() as conn:
                    row = (
                        await conn.execute(
                            update(ma_sessions)
                            .where(
                                ma_sessions.c.id == session_id,
                                ma_sessions.c.tenant_id == tenant_id,
                            )
                            .values(
                                last_seq=ma_sessions.c.last_seq + count,
                                updated_at=now,
                            )
                            .returning(
                                ma_sessions.c.last_seq,
                                ma_sessions.c.agent_id,
                                ma_sessions.c.agent_version,
                                ma_sessions.c.created_by_user_id,
                            )
                        )
                    ).first()
                    if row is None:
                        raise MAError(SESSION_NOT_FOUND, "session not found")
                    base = int(row.last_seq) - count
                    event_rows: list[dict[str, Any]] = []
                    usage_rows: list[dict[str, Any]] = []
                    stored: list[StoredEvent] = []
                    created = _iso(now) or utc_now_iso(now)
                    for index, event in enumerate(events):
                        seq = base + index + 1
                        payload = {
                            key: value for key, value in event.items() if key not in ENVELOPE_KEYS
                        }
                        processed = event.get("processed_at")
                        event_rows.append(
                            {
                                "id": ids[index],
                                "tenant_id": tenant_id,
                                "session_id": session_id,
                                "seq": seq,
                                "thread_id": _optional_str(event.get("thread_id")),
                                "type": event["type"],
                                "payload": payload,
                                "created_at": now,
                                "processed_at": parse_iso(processed) if processed else None,
                            }
                        )
                        if event["type"] == "span.model_request_end":
                            model_usage = payload.get("model_usage") or {}
                            if not isinstance(model_usage, Mapping):
                                model_usage = {}
                            usage_rows.append(
                                {
                                    "id": new_ulid(),
                                    "tenant_id": tenant_id,
                                    "session_id": session_id,
                                    "agent_id": row.agent_id,
                                    "agent_version": row.agent_version,
                                    "user_id": row.created_by_user_id,
                                    "model": str(payload.get("model") or "")[:160],
                                    "input_tokens": int(model_usage.get("input_tokens") or 0),
                                    "output_tokens": int(model_usage.get("output_tokens") or 0),
                                    "cache_read_input_tokens": int(
                                        model_usage.get("cache_read_input_tokens") or 0
                                    ),
                                    "tool_calls": 0,
                                    "runtime_ms": 0,
                                    "is_error": bool(payload.get("is_error")),
                                    "event_seq": seq,
                                    "created_at": now,
                                }
                            )
                        stored.append(
                            StoredEvent(
                                id=ids[index],
                                tenant_id=tenant_id,
                                session_id=session_id,
                                seq=seq,
                                type=str(event["type"]),
                                payload=payload,
                                created_at=created,
                                thread_id=_optional_str(event.get("thread_id")),
                                processed_at=_optional_str(processed),
                            )
                        )
                    await conn.execute(ma_session_events.insert(), event_rows)
                    if usage_rows:
                        stmt = _insert_ignore(
                            conn.dialect.name,
                            ma_session_usage,
                            ("session_id", "event_seq"),
                        )
                        await conn.execute(stmt, usage_rows)
                    return stored
        except IntegrityError as exc:
            raise MAError(INVALID_EVENT_BATCH, "duplicate event id") from exc

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
        stmt = (
            select(ma_session_events)
            .where(
                ma_session_events.c.tenant_id == tenant_id,
                ma_session_events.c.session_id == session_id,
                ma_session_events.c.seq > after_seq,
            )
            .order_by(ma_session_events.c.seq)
            .limit(_clamp_limit(limit))
        )
        if types:
            stmt = stmt.where(ma_session_events.c.type.in_(list(types)))
        if thread_filter is not None:
            column = ma_session_events.c
            if thread_filter.mode == "session":
                stmt = stmt.where(
                    or_(
                        column.thread_id.is_(None),
                        column.type.in_(sorted(SESSION_VISIBLE_THREAD_TYPES)),
                    )
                )
            elif thread_filter.thread_id is None:
                stmt = stmt.where(column.thread_id.is_(None))
            else:
                stmt = stmt.where(column.thread_id == thread_filter.thread_id)
        async with self._engine.connect() as conn:
            rows = (await conn.execute(stmt)).mappings().all()
        return [_row_to_event(row) for row in rows]

    async def get_event(
        self,
        tenant_id: str,
        session_id: str,
        event_id: str,
    ) -> StoredEvent | None:
        stmt = select(ma_session_events).where(
            ma_session_events.c.tenant_id == tenant_id,
            ma_session_events.c.session_id == session_id,
            ma_session_events.c.id == event_id,
        )
        async with self._engine.connect() as conn:
            row = (await conn.execute(stmt)).mappings().first()
        if row is None:
            return None
        return _row_to_event(row)

    async def mark_processed(
        self,
        tenant_id: str,
        session_id: str,
        event_ids: Sequence[str],
        processed_at: str,
    ) -> None:
        if not event_ids:
            return
        async with self._write_guard():
            async with self._engine.begin() as conn:
                await conn.execute(
                    update(ma_session_events)
                    .where(
                        ma_session_events.c.tenant_id == tenant_id,
                        ma_session_events.c.session_id == session_id,
                        ma_session_events.c.processed_at.is_(None),
                        ma_session_events.c.id.in_(list(event_ids)),
                    )
                    .values(processed_at=parse_iso(processed_at))
                )

    async def last_seq(self, tenant_id: str, session_id: str) -> int:
        stmt = select(ma_sessions.c.last_seq).where(
            ma_sessions.c.id == session_id,
            ma_sessions.c.tenant_id == tenant_id,
        )
        async with self._engine.connect() as conn:
            row = (await conn.execute(stmt)).first()
        if row is None:
            return 0
        return int(row.last_seq)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._engine.dispose()

    async def _load_session(self, conn: Any, tenant_id: str, session_id: str) -> SessionRecord | None:
        row = (
            await conn.execute(
                select(ma_sessions).where(
                    ma_sessions.c.id == session_id,
                    ma_sessions.c.tenant_id == tenant_id,
                )
            )
        ).mappings().first()
        if row is None:
            return None
        return _row_to_session(row)


def _validated_ids(events: Sequence[Mapping[str, Any]]) -> list[str]:
    ids: list[str] = []
    for index, event in enumerate(events):
        event_type = event.get("type")
        if not isinstance(event_type, str) or not event_type:
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: missing type",
                details={"index": index},
            )
        raw_id = event.get("id") or new_ulid()
        if not is_ulid(raw_id):
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}].id: must be a ULID",
                details={"index": index},
            )
        ids.append(str(raw_id))
    if len(set(ids)) != len(ids):
        raise MAError(INVALID_EVENT_BATCH, "duplicate event id")
    return ids


def _update_values(changes: Mapping[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if "status" in changes:
        status = changes["status"]
        if not isinstance(status, str):
            raise ValueError("status must be str")
        values["status"] = status
    if "stop_reason" in changes:
        values["stop_reason"] = _stop_reason_value(changes["stop_reason"])
    if "usage" in changes:
        values["usage_totals"] = _usage_value(changes["usage"])
    if "title" in changes:
        values["title"] = _nullable_str("title", changes["title"])
    if "archived_at" in changes:
        archived = _nullable_str("archived_at", changes["archived_at"])
        values["archived_at"] = parse_iso(archived) if archived else None
    return values


def _nullable_str(name: str, value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise ValueError(f"{name} must be str or None")


def _stop_reason_value(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("stop_reason must be dict or None")
    try:
        parsed = StopReason.model_validate(dict(value))
    except ValidationError as exc:
        raise ValueError("stop_reason is invalid") from exc
    return parsed.model_dump(mode="json")


def _usage_value(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("usage must be dict")
    try:
        parsed = Usage.model_validate(dict(value))
    except ValidationError as exc:
        raise ValueError("usage is invalid") from exc
    return parsed.model_dump(mode="json")


def _row_to_session(row: Mapping[str, Any]) -> SessionRecord:
    raw_stop = _as_mapping(row["stop_reason"]) if row["stop_reason"] is not None else None
    stop = StopReason.model_validate(raw_stop) if raw_stop else None
    usage_raw = _as_mapping(row["usage_totals"])
    usage = Usage.model_validate({key: usage_raw.get(key, 0) or 0 for key in _USAGE_KEYS})
    created = _iso(row["created_at"])
    updated = _iso(row["updated_at"])
    if created is None or updated is None:
        raise RuntimeError("session row is missing timestamps")
    return SessionRecord.model_validate(
        {
            "id": row["id"],
            "tenant_id": row["tenant_id"],
            "agent_id": row["agent_id"],
            "agent_version": int(row["agent_version"]),
            "environment_id": row["environment_id"],
            "created_by_user_id": row["created_by_user_id"],
            "source": row["source"],
            "status": row["status"],
            "stop_reason": stop,
            "title": row["title"],
            "vault_ids": _as_list(row["vault_ids"]),
            "resources": _as_list(row["resources"]),
            "usage": usage,
            "created_at": created,
            "updated_at": updated,
            "archived_at": _iso(row["archived_at"]),
        }
    )


def _row_to_event(row: Mapping[str, Any]) -> StoredEvent:
    payload = _as_mapping(row["payload"])
    created = _iso(row["created_at"])
    if created is None:
        raise RuntimeError("event row is missing created_at")
    return StoredEvent(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        session_id=str(row["session_id"]),
        seq=int(row["seq"]),
        type=str(row["type"]),
        payload=payload,
        created_at=created,
        thread_id=row["thread_id"],
        processed_at=_iso(row["processed_at"]),
    )


def _rowcount(result: Any) -> int:
    if isinstance(result, CursorResult):
        return int(result.rowcount or 0)
    return int(getattr(result, "rowcount", 0) or 0)


__all__ = [
    "PgEventStore",
    "_insert_ignore",
]
