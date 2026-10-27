#!/usr/bin/env python3
"""SQLite EventStore for the Managed Agents W1 host.

Author: Damon Li
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Mapping, Sequence

from pydantic import ValidationError

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
from agenticx.managed.ids import is_ulid, new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord, StopReason, Usage

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ma_sessions (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  agent_version       INTEGER NOT NULL,
  environment_id      TEXT,
  created_by_user_id  TEXT,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  stop_reason         TEXT,
  title               TEXT,
  vault_ids           TEXT NOT NULL DEFAULT '[]',
  resources           TEXT NOT NULL DEFAULT '[]',
  usage               TEXT NOT NULL DEFAULT '{}',
  last_seq            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  archived_at         TEXT
);
CREATE INDEX IF NOT EXISTS ix_ma_sessions_tenant_created
  ON ma_sessions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ma_sessions_status ON ma_sessions(status);

CREATE TABLE IF NOT EXISTS ma_session_events (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES ma_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  thread_id     TEXT,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  processed_at  TEXT,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_ma_events_session_seq
  ON ma_session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS ix_ma_events_session_type
  ON ma_session_events(session_id, type, seq);
"""

_UNSETTLED_SQL = """
SELECT * FROM ma_sessions
WHERE status IN ('running', 'rescheduling')
   OR (status = 'idle' AND json_extract(stop_reason, '$.type') = 'requires_action')
"""


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _clamp_limit(limit: int) -> int:
    if limit < 1:
        return 1
    if limit > MAX_LIST_LIMIT:
        return MAX_LIST_LIMIT
    return limit


def _optional_str(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    return None


class SqliteEventStore(EventStore):
    """Single-connection SQLite store.

    Async methods call SQLite directly on the event-loop thread. Every access
    takes ``lock``. MA-A05 may share ``connection`` for the work queue and must
    take the same lock. ``isolation_level=None`` so transactions are explicit
    ``BEGIN IMMEDIATE`` blocks.
    """

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._closed = False
        self._conn = sqlite3.connect(
            str(self._path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)
            self._conn.execute("PRAGMA user_version = 1")

    @property
    def connection(self) -> sqlite3.Connection:
        """Shared connection. Callers must hold ``lock`` and stop after ``close``."""
        return self._conn

    @property
    def lock(self) -> threading.RLock:
        """Lock that guards ``connection``."""
        return self._lock

    async def create_session(self, record: SessionRecord) -> SessionRecord:
        with self._lock:
            self._ensure_open()
            existing = self._conn.execute(
                "SELECT 1 FROM ma_sessions WHERE id = ?",
                (record.id,),
            ).fetchone()
            if existing is not None:
                raise ValueError("session already exists")
            dumped = record.model_dump(mode="json")
            try:
                self._conn.execute(
                    """
                    INSERT INTO ma_sessions (
                      id, tenant_id, agent_id, agent_version, environment_id,
                      created_by_user_id, source, status, stop_reason, title,
                      vault_ids, resources, usage, last_seq,
                      created_at, updated_at, archived_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                    """,
                    (
                        dumped["id"],
                        dumped["tenant_id"],
                        dumped["agent_id"],
                        dumped["agent_version"],
                        dumped.get("environment_id"),
                        dumped.get("created_by_user_id"),
                        dumped["source"],
                        dumped["status"],
                        _dump(dumped["stop_reason"]) if dumped.get("stop_reason") is not None else None,
                        dumped.get("title"),
                        _dump(dumped.get("vault_ids") or []),
                        _dump(dumped.get("resources") or []),
                        _dump(dumped.get("usage") or {}),
                        dumped["created_at"],
                        dumped["updated_at"],
                        dumped.get("archived_at"),
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("session already exists") from exc
            loaded = self._load_session(record.tenant_id, record.id)
            if loaded is None:
                raise RuntimeError("inserted session could not be reloaded")
            return loaded

    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        with self._lock:
            self._ensure_open()
            return self._load_session(tenant_id, session_id)

    async def update_session(
        self,
        tenant_id: str,
        session_id: str,
        changes: Mapping[str, Any],
    ) -> SessionRecord:
        unknown = set(changes) - ALLOWED_SESSION_UPDATE_KEYS
        if unknown:
            names = ", ".join(sorted(str(key) for key in unknown))
            raise ValueError(f"unknown session update keys: {names}")
        assignments, params = _update_assignments(changes)
        assignments.append("updated_at = ?")
        params.append(utc_now_iso())
        params.extend([session_id, tenant_id])
        with self._lock:
            self._ensure_open()
            if self._load_session(tenant_id, session_id) is None:
                raise MAError(SESSION_NOT_FOUND, "session not found")
            self._conn.execute(
                f"UPDATE ma_sessions SET {', '.join(assignments)} WHERE id = ? AND tenant_id = ?",
                params,
            )
            loaded = self._load_session(tenant_id, session_id)
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
        sql = "SELECT * FROM ma_sessions WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if agent_id is not None:
            sql += " AND agent_id = ?"
            params.append(agent_id)
        if created_by_user_id is not None:
            sql += " AND created_by_user_id = ?"
            params.append(created_by_user_id)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(_clamp_limit(limit))
        with self._lock:
            self._ensure_open()
            rows = self._conn.execute(sql, params).fetchall()
        return [_row_to_session(row) for row in rows]

    async def list_unsettled_sessions(self) -> list[SessionRecord]:
        with self._lock:
            self._ensure_open()
            rows = self._conn.execute(_UNSETTLED_SQL).fetchall()
        return [_row_to_session(row) for row in rows]

    async def append_events(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        if not events:
            return []
        with self._lock:
            self._ensure_open()
            return self._append_locked(tenant_id, session_id, events)

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
        sql = (
            "SELECT * FROM ma_session_events "
            "WHERE tenant_id = ? AND session_id = ? AND seq > ?"
        )
        params: list[Any] = [tenant_id, session_id, after_seq]
        if types:
            placeholders = ", ".join("?" for _ in types)
            sql += f" AND type IN ({placeholders})"
            params.extend(types)
        if thread_filter is not None:
            if thread_filter.mode == "session":
                marks = ", ".join("?" for _ in SESSION_VISIBLE_THREAD_TYPES)
                sql += f" AND (thread_id IS NULL OR type IN ({marks}))"
                params.extend(sorted(SESSION_VISIBLE_THREAD_TYPES))
            elif thread_filter.thread_id is None:
                sql += " AND thread_id IS NULL"
            else:
                sql += " AND thread_id = ?"
                params.append(thread_filter.thread_id)
        sql += " ORDER BY seq ASC LIMIT ?"
        params.append(_clamp_limit(limit))
        with self._lock:
            self._ensure_open()
            rows = self._conn.execute(sql, params).fetchall()
        return [_row_to_event(row) for row in rows]

    async def get_event(
        self,
        tenant_id: str,
        session_id: str,
        event_id: str,
    ) -> StoredEvent | None:
        with self._lock:
            self._ensure_open()
            row = self._conn.execute(
                """
                SELECT * FROM ma_session_events
                WHERE tenant_id = ? AND session_id = ? AND id = ?
                """,
                (tenant_id, session_id, event_id),
            ).fetchone()
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
        placeholders = ", ".join("?" for _ in event_ids)
        params: list[Any] = [processed_at, tenant_id, session_id, *event_ids]
        with self._lock:
            self._ensure_open()
            self._conn.execute(
                f"""
                UPDATE ma_session_events
                SET processed_at = ?
                WHERE tenant_id = ? AND session_id = ?
                  AND processed_at IS NULL
                  AND id IN ({placeholders})
                """,
                params,
            )

    async def last_seq(self, tenant_id: str, session_id: str) -> int:
        with self._lock:
            self._ensure_open()
            row = self._conn.execute(
                "SELECT last_seq FROM ma_sessions WHERE id = ? AND tenant_id = ?",
                (session_id, tenant_id),
            ).fetchone()
        if row is None:
            return 0
        return int(row["last_seq"])

    async def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._conn.close()
            self._closed = True

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("event store is closed")

    def _load_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        row = self._conn.execute(
            "SELECT * FROM ma_sessions WHERE id = ? AND tenant_id = ?",
            (session_id, tenant_id),
        ).fetchone()
        if row is None:
            return None
        return _row_to_session(row)

    def _append_locked(
        self,
        tenant_id: str,
        session_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[StoredEvent]:
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            row = self._conn.execute(
                "SELECT last_seq FROM ma_sessions WHERE id = ? AND tenant_id = ?",
                (session_id, tenant_id),
            ).fetchone()
            if row is None:
                raise MAError(SESSION_NOT_FOUND, "session not found")
            seq = int(row["last_seq"])
            now = utc_now_iso()
            stored: list[StoredEvent] = []
            for index, event in enumerate(events):
                if "type" not in event or not isinstance(event.get("type"), str) or not event.get("type"):
                    raise MAError(
                        INVALID_EVENT_BATCH,
                        f"events[{index}]: missing type",
                        details={"index": index},
                    )
                event_id = event.get("id") or new_ulid()
                if not is_ulid(event_id):
                    raise MAError(
                        INVALID_EVENT_BATCH,
                        f"events[{index}].id: must be a ULID",
                        details={"index": index},
                    )
                seq += 1
                payload = {key: value for key, value in event.items() if key not in ENVELOPE_KEYS}
                event_type = str(event["type"])
                thread_id = _optional_str(event.get("thread_id"))
                processed_at = _optional_str(event.get("processed_at"))
                self._conn.execute(
                    """
                    INSERT INTO ma_session_events (
                      id, tenant_id, session_id, seq, thread_id, type,
                      payload, created_at, processed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event_id,
                        tenant_id,
                        session_id,
                        seq,
                        thread_id,
                        event_type,
                        _dump(payload),
                        now,
                        processed_at,
                    ),
                )
                stored.append(
                    StoredEvent(
                        id=event_id,
                        tenant_id=tenant_id,
                        session_id=session_id,
                        seq=seq,
                        type=event_type,
                        payload=payload,
                        created_at=now,
                        thread_id=thread_id,
                        processed_at=processed_at,
                    )
                )
            self._conn.execute(
                "UPDATE ma_sessions SET last_seq = ?, updated_at = ? WHERE id = ?",
                (seq, now, session_id),
            )
            self._conn.execute("COMMIT")
            return stored
        except sqlite3.IntegrityError:
            _rollback(self._conn)
            raise MAError(INVALID_EVENT_BATCH, "duplicate event id") from None
        except BaseException:
            _rollback(self._conn)
            raise


def _rollback(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("ROLLBACK")
    except sqlite3.Error:
        return


def _update_assignments(changes: Mapping[str, Any]) -> tuple[list[str], list[Any]]:
    assignments: list[str] = []
    params: list[Any] = []
    if "status" in changes:
        status = changes["status"]
        if not isinstance(status, str):
            raise ValueError("status must be str")
        assignments.append("status = ?")
        params.append(status)
    if "stop_reason" in changes:
        assignments.append("stop_reason = ?")
        params.append(_stop_reason_param(changes["stop_reason"]))
    if "usage" in changes:
        assignments.append("usage = ?")
        params.append(_usage_param(changes["usage"]))
    if "title" in changes:
        assignments.append("title = ?")
        params.append(_nullable_str("title", changes["title"]))
    if "archived_at" in changes:
        assignments.append("archived_at = ?")
        params.append(_nullable_str("archived_at", changes["archived_at"]))
    return assignments, params


def _nullable_str(name: str, value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise ValueError(f"{name} must be str or None")


def _stop_reason_param(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("stop_reason must be dict or None")
    try:
        parsed = StopReason.model_validate(dict(value))
    except ValidationError as exc:
        raise ValueError("stop_reason is invalid") from exc
    return _dump(parsed.model_dump(mode="json"))


def _usage_param(value: Any) -> str:
    if not isinstance(value, Mapping):
        raise ValueError("usage must be dict")
    try:
        parsed = Usage.model_validate(dict(value))
    except ValidationError as exc:
        raise ValueError("usage is invalid") from exc
    return _dump(parsed.model_dump(mode="json"))


def _row_to_session(row: sqlite3.Row) -> SessionRecord:
    raw_stop = row["stop_reason"]
    stop: StopReason | None = None
    if raw_stop:
        stop = StopReason.model_validate(json.loads(raw_stop))
    usage = Usage.model_validate(json.loads(row["usage"]))
    return SessionRecord.model_validate(
        {
            "id": row["id"],
            "tenant_id": row["tenant_id"],
            "agent_id": row["agent_id"],
            "agent_version": row["agent_version"],
            "environment_id": row["environment_id"],
            "created_by_user_id": row["created_by_user_id"],
            "source": row["source"],
            "status": row["status"],
            "stop_reason": stop,
            "title": row["title"],
            "vault_ids": json.loads(row["vault_ids"]),
            "resources": json.loads(row["resources"]),
            "usage": usage,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "archived_at": row["archived_at"],
        }
    )


def _row_to_event(row: sqlite3.Row) -> StoredEvent:
    payload = json.loads(row["payload"])
    if not isinstance(payload, dict):
        payload = {}
    return StoredEvent(
        id=row["id"],
        tenant_id=row["tenant_id"],
        session_id=row["session_id"],
        seq=int(row["seq"]),
        type=row["type"],
        payload=payload,
        created_at=row["created_at"],
        thread_id=row["thread_id"],
        processed_at=row["processed_at"],
    )
