#!/usr/bin/env python3
"""SQLite persistence for runtime session states.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

DEFAULT_SESSION_DB_PATH = Path.home() / ".agenticx" / "memory" / "sessions.sqlite"


class SessionStore:
    """Store todo/scratchpad/session summaries in SQLite."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = Path(db_path or DEFAULT_SESSION_DB_PATH).expanduser().resolve(strict=False)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS todos (
                    session_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scratchpad (
                    session_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (session_id, key)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_summaries (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    async def save_todos(self, session_id: str, items: List[Dict[str, Any]]) -> None:
        await asyncio.to_thread(self._save_todos_sync, session_id, items)

    def _save_todos_sync(self, session_id: str, items: List[Dict[str, Any]]) -> None:
        payload = json.dumps(items, ensure_ascii=False)
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO todos (session_id, data, updated_at)
                VALUES (?, ?, ?)
                """,
                (session_id, payload, now),
            )
            conn.commit()

    async def load_todos(self, session_id: str) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._load_todos_sync, session_id)

    def _load_todos_sync(self, session_id: str) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT data FROM todos WHERE session_id = ?", (session_id,)).fetchone()
            if row is None:
                return []
            try:
                payload = json.loads(str(row["data"]))
                return payload if isinstance(payload, list) else []
            except Exception:
                return []

    async def save_scratchpad(self, session_id: str, data: Dict[str, str]) -> None:
        await asyncio.to_thread(self._save_scratchpad_sync, session_id, data)

    def _save_scratchpad_sync(self, session_id: str, data: Dict[str, str]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute("DELETE FROM scratchpad WHERE session_id = ?", (session_id,))
            rows = [(session_id, key, value, now) for key, value in data.items()]
            conn.executemany(
                """
                INSERT INTO scratchpad (session_id, key, value, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()

    async def load_scratchpad(self, session_id: str) -> Dict[str, str]:
        return await asyncio.to_thread(self._load_scratchpad_sync, session_id)

    def _load_scratchpad_sync(self, session_id: str) -> Dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT key, value FROM scratchpad WHERE session_id = ? ORDER BY key",
                (session_id,),
            ).fetchall()
            return {str(row["key"]): str(row["value"]) for row in rows}

    async def save_session_summary(
        self,
        session_id: str,
        summary: str,
        metadata: Dict[str, Any] | None = None,
    ) -> None:
        await asyncio.to_thread(self._save_session_summary_sync, session_id, summary, metadata or {})

    def _save_session_summary_sync(
        self,
        session_id: str,
        summary: str,
        metadata: Dict[str, Any],
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO session_summaries (id, session_id, summary, metadata, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    session_id,
                    summary,
                    json.dumps(metadata, ensure_ascii=False),
                    now,
                ),
            )
            conn.commit()

    async def search_session_summaries(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._search_session_summaries_sync, query, limit)

    async def load_latest_session_metadata(self, session_id: str) -> Dict[str, Any]:
        return await asyncio.to_thread(self._load_latest_session_metadata_sync, session_id)

    async def list_latest_sessions(self, limit: int = 500) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._list_latest_sessions_sync, limit)

    async def purge_session(self, session_id: str) -> bool:
        return await asyncio.to_thread(self._purge_session_sync, session_id)

    async def session_exists(self, session_id: str) -> bool:
        return await asyncio.to_thread(self._session_exists_sync, session_id)

    def _load_latest_session_metadata_sync(self, session_id: str) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT metadata
                FROM session_summaries
                WHERE session_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
            if row is None:
                return {}
            try:
                payload = json.loads(str(row["metadata"] or "{}"))
            except Exception:
                return {}
            return payload if isinstance(payload, dict) else {}

    def _list_latest_sessions_sync(self, limit: int = 500) -> List[Dict[str, Any]]:
        safe_limit = int(limit)
        use_limit = safe_limit > 0
        with self._connect() as conn:
            if use_limit:
                rows = conn.execute(
                    """
                    SELECT s.session_id, s.created_at, s.metadata
                    FROM session_summaries AS s
                    INNER JOIN (
                        SELECT session_id, MAX(created_at) AS max_created_at
                        FROM session_summaries
                        GROUP BY session_id
                    ) AS latest
                      ON s.session_id = latest.session_id
                     AND s.created_at = latest.max_created_at
                    ORDER BY s.created_at DESC
                    LIMIT ?
                    """,
                    (safe_limit,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT s.session_id, s.created_at, s.metadata
                    FROM session_summaries AS s
                    INNER JOIN (
                        SELECT session_id, MAX(created_at) AS max_created_at
                        FROM session_summaries
                        GROUP BY session_id
                    ) AS latest
                      ON s.session_id = latest.session_id
                     AND s.created_at = latest.max_created_at
                    ORDER BY s.created_at DESC
                    """
                ).fetchall()
            result: List[Dict[str, Any]] = []
            for row in rows:
                metadata: Dict[str, Any] = {}
                try:
                    metadata = json.loads(str(row["metadata"] or "{}"))
                except Exception:
                    metadata = {}
                result.append(
                    {
                        "session_id": str(row["session_id"]),
                        "created_at": str(row["created_at"]),
                        "metadata": metadata if isinstance(metadata, dict) else {},
                    }
                )
            return result

    def _purge_session_sync(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        with self._connect() as conn:
            c1 = conn.execute("DELETE FROM todos WHERE session_id = ?", (sid,)).rowcount
            c2 = conn.execute("DELETE FROM scratchpad WHERE session_id = ?", (sid,)).rowcount
            c3 = conn.execute("DELETE FROM session_summaries WHERE session_id = ?", (sid,)).rowcount
            conn.commit()
        return (c1 + c2 + c3) > 0

    def _session_exists_sync(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        with self._connect() as conn:
            todos = conn.execute("SELECT 1 FROM todos WHERE session_id = ? LIMIT 1", (sid,)).fetchone()
            if todos is not None:
                return True
            scratch = conn.execute("SELECT 1 FROM scratchpad WHERE session_id = ? LIMIT 1", (sid,)).fetchone()
            if scratch is not None:
                return True
            summaries = conn.execute("SELECT 1 FROM session_summaries WHERE session_id = ? LIMIT 1", (sid,)).fetchone()
            return summaries is not None

    def _search_session_summaries_sync(self, query: str, limit: int) -> List[Dict[str, Any]]:
        q = f"%{query.strip()}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, session_id, summary, metadata, created_at
                FROM session_summaries
                WHERE summary LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (q, max(1, int(limit))),
            ).fetchall()
            result: List[Dict[str, Any]] = []
            for row in rows:
                metadata: Dict[str, Any] = {}
                try:
                    metadata = json.loads(str(row["metadata"] or "{}"))
                except Exception:
                    metadata = {}
                result.append(
                    {
                        "id": str(row["id"]),
                        "session_id": str(row["session_id"]),
                        "summary": str(row["summary"]),
                        "metadata": metadata,
                        "created_at": str(row["created_at"]),
                    }
                )
            return result
