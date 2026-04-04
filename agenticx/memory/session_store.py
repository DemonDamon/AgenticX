#!/usr/bin/env python3
"""SQLite persistence for runtime session states.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

DEFAULT_SESSION_DB_PATH = Path.home() / ".agenticx" / "memory" / "sessions.sqlite"


def session_fts_enabled() -> bool:
    """Return True when session message FTS indexing/search is active (default: on)."""
    v = os.environ.get("AGX_SESSION_FTS", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _sanitize_fts5_query(query: str) -> str:
    """Sanitize user input for safe use in FTS5 MATCH queries (Hermes-aligned)."""
    if not query or not query.strip():
        return ""
    _quoted_parts: list[str] = []

    def _preserve_quoted(m: re.Match[str]) -> str:
        _quoted_parts.append(m.group(0))
        return f"\x00Q{len(_quoted_parts) - 1}\x00"

    sanitized = re.sub(r'"[^"]*"', _preserve_quoted, query)

    sanitized = re.sub(r'[+{}()\"^]', " ", sanitized)

    sanitized = re.sub(r"\*+", "*", sanitized)
    sanitized = re.sub(r"(^|\s)\*", r"\1", sanitized)

    sanitized = re.sub(r"(?i)^(AND|OR|NOT)\b\s*", "", sanitized.strip())
    sanitized = re.sub(r"(?i)\s+(AND|OR|NOT)\s*$", "", sanitized.strip())

    sanitized = re.sub(r"\b(\w+(?:-\w+)+)\b", r'"\1"', sanitized)

    for i, quoted in enumerate(_quoted_parts):
        sanitized = sanitized.replace(f"\x00Q{i}\x00", quoted)

    return sanitized.strip()


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

    def _ensure_session_messages_fts_triggers(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type='trigger' AND name LIKE 'session_messages_%'
            """
        ).fetchall()
        existing = {str(r[0]) for r in rows}
        if "session_messages_ai" not in existing:
            conn.execute(
                """
                CREATE TRIGGER session_messages_ai AFTER INSERT ON session_messages BEGIN
                    INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
                END
                """
            )
        if "session_messages_ad" not in existing:
            conn.execute(
                """
                CREATE TRIGGER session_messages_ad AFTER DELETE ON session_messages BEGIN
                    INSERT INTO session_messages_fts(session_messages_fts, rowid)
                    VALUES('delete', old.id);
                END
                """
            )
        if "session_messages_bu" not in existing:
            conn.execute(
                """
                CREATE TRIGGER session_messages_bu BEFORE UPDATE ON session_messages BEGIN
                    INSERT INTO session_messages_fts(session_messages_fts, rowid)
                    VALUES('delete', old.id);
                END
                """
            )
        if "session_messages_au" not in existing:
            conn.execute(
                """
                CREATE TRIGGER session_messages_au AFTER UPDATE ON session_messages BEGIN
                    INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
                END
                """
            )

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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp REAL,
                    indexed_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sm_session ON session_messages(session_id)"
            )
            conn.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
                    content,
                    content='session_messages',
                    content_rowid='id'
                )
                """
            )
            self._ensure_session_messages_fts_triggers(conn)
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

    async def index_session_messages(self, session_id: str, messages: List[Dict[str, Any]]) -> int:
        return await asyncio.to_thread(self._index_session_messages_sync, session_id, messages)

    async def search_session_messages(
        self,
        query: str,
        *,
        role_filter: List[str] | None = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(
            self._search_session_messages_sync, query, role_filter, limit
        )

    @staticmethod
    def _message_content_text(msg: Dict[str, Any]) -> str:
        raw = msg.get("content")
        if raw is None:
            return ""
        if isinstance(raw, str):
            return raw
        if isinstance(raw, list):
            parts: List[str] = []
            for item in raw:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    if item.get("type") in ("text", "input_text") and isinstance(
                        item.get("text"), str
                    ):
                        parts.append(str(item["text"]))
                    else:
                        parts.append(json.dumps(item, ensure_ascii=False))
                else:
                    parts.append(str(item))
            return "\n".join(parts)
        return str(raw)

    @staticmethod
    def _message_timestamp(msg: Dict[str, Any]) -> float | None:
        for key in ("timestamp", "created_at", "ts"):
            v = msg.get(key)
            if v is None:
                continue
            if isinstance(v, (int, float)):
                return float(v)
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    def _index_session_messages_sync(self, session_id: str, messages: List[Dict[str, Any]]) -> int:
        if not session_fts_enabled():
            return 0
        sid = str(session_id or "").strip()
        if not sid:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        rows: List[tuple[Any, ...]] = []
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "") or "unknown").strip() or "unknown"
            text = self._message_content_text(msg)
            if len(text) > 200_000:
                text = text[:200_000] + "\n... (truncated)"
            ts = self._message_timestamp(msg)
            rows.append((sid, role, text, ts, now))
        with self._connect() as conn:
            conn.execute("DELETE FROM session_messages WHERE session_id = ?", (sid,))
            if rows:
                conn.executemany(
                    """
                    INSERT INTO session_messages (session_id, role, content, timestamp, indexed_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    rows,
                )
            conn.commit()
        return len(rows)

    def _search_session_messages_sync(
        self,
        query: str,
        role_filter: List[str] | None,
        limit: int,
    ) -> List[Dict[str, Any]]:
        if not session_fts_enabled():
            return []
        raw_q = (query or "").strip()
        if not raw_q:
            return []
        safe_q = _sanitize_fts5_query(raw_q)
        if not safe_q:
            return []
        n = max(1, min(int(limit), 500))
        roles: List[str] = []
        if role_filter:
            for r in role_filter:
                t = str(r or "").strip().lower()
                if t in {"user", "assistant", "tool", "system"}:
                    roles.append(t)
        where_role = ""
        params: List[Any] = [safe_q]
        if roles:
            placeholders = ",".join("?" for _ in roles)
            where_role = f" AND sm.role IN ({placeholders})"
            params.extend(roles)
        params.append(n)
        sql = f"""
            SELECT sm.id, sm.session_id, sm.role, sm.content, sm.timestamp,
                   snippet(session_messages_fts, 0, '»', '«', '…', 40) AS snippet
            FROM session_messages_fts
            JOIN session_messages sm ON sm.id = session_messages_fts.rowid
            WHERE session_messages_fts MATCH ?{where_role}
            ORDER BY sm.timestamp DESC NULLS LAST, sm.id DESC
            LIMIT ?
        """
        with self._connect() as conn:
            try:
                cur = conn.execute(sql, params)
                fetched = cur.fetchall()
            except sqlite3.OperationalError:
                return []
        out: List[Dict[str, Any]] = []
        for row in fetched:
            content_full = str(row["content"] or "")
            preview = content_full if len(content_full) <= 800 else content_full[:800] + "…"
            ctx_before, ctx_after = self._neighbor_context_sync(
                conn=None,
                session_id=str(row["session_id"]),
                row_id=int(row["id"]),
            )
            out.append(
                {
                    "id": int(row["id"]),
                    "session_id": str(row["session_id"]),
                    "role": str(row["role"]),
                    "snippet": str(row["snippet"] or ""),
                    "content_preview": preview,
                    "timestamp": row["timestamp"],
                    "context_before": ctx_before,
                    "context_after": ctx_after,
                }
            )
        return out

    def _search_session_messages_like_sync(
        self,
        query: str,
        allowed_session_ids: frozenset[str],
        limit: int,
    ) -> List[Dict[str, Any]]:
        """Substring search in message bodies for allowed sessions (FTS fallback, CJK-friendly)."""
        raw = (query or "").strip()
        if not raw or not allowed_session_ids:
            return []
        if len(raw) > 500:
            raw = raw[:500]
        esc = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{esc}%"
        n = max(1, min(int(limit), 400))
        ids = [sid for sid in allowed_session_ids if sid]
        out: List[Dict[str, Any]] = []
        chunk_size = 80
        with self._connect() as conn:
            for i in range(0, len(ids), chunk_size):
                part = ids[i : i + chunk_size]
                if not part:
                    break
                placeholders = ",".join("?" * len(part))
                sql = f"""
                    SELECT id, session_id, role, content, timestamp
                    FROM session_messages
                    WHERE session_id IN ({placeholders}) AND content LIKE ? ESCAPE '\\'
                    ORDER BY timestamp DESC NULLS LAST, id DESC
                    LIMIT ?
                """
                try:
                    cur = conn.execute(sql, (*part, pattern, n - len(out)))
                except sqlite3.OperationalError:
                    continue
                for row in cur.fetchall():
                    out.append(
                        {
                            "id": int(row["id"]),
                            "session_id": str(row["session_id"]),
                            "role": str(row["role"]),
                            "content": str(row["content"] or ""),
                            "timestamp": row["timestamp"],
                        }
                    )
                    if len(out) >= n:
                        return out
        return out

    async def backfill_from_sessions_root(
        self,
        sessions_root: Path | str,
        *,
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """Scan ``sessions_root/<session_id>/messages.json`` and index all sessions
        that are not yet in the FTS table.  Safe to call multiple times.

        Args:
            sessions_root: Path to ``~/.agenticx/sessions``.
            overwrite: Re-index even if already indexed (default False).

        Returns:
            {"indexed": N, "skipped": M, "errors": K}
        """
        return await asyncio.to_thread(
            self._backfill_from_sessions_root_sync, sessions_root, overwrite
        )

    def _backfill_from_sessions_root_sync(
        self,
        sessions_root: Path | str,
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        if not session_fts_enabled():
            return {"indexed": 0, "skipped": 0, "errors": 0, "reason": "fts_disabled"}
        root = Path(sessions_root).expanduser().resolve(strict=False)
        if not root.exists():
            return {"indexed": 0, "skipped": 0, "errors": 0}
        indexed = skipped = errors = 0
        already_indexed_ids: set[str] = set()
        if not overwrite:
            with self._connect() as conn:
                rows = conn.execute(
                    "SELECT DISTINCT session_id FROM session_messages"
                ).fetchall()
                already_indexed_ids = {str(r[0]) for r in rows}
        for session_dir in sorted(root.iterdir()):
            if not session_dir.is_dir():
                continue
            sid = session_dir.name
            if not overwrite and sid in already_indexed_ids:
                skipped += 1
                continue
            msgs_path = session_dir / "messages.json"
            if not msgs_path.is_file():
                skipped += 1
                continue
            try:
                with msgs_path.open(encoding="utf-8") as fh:
                    data = json.load(fh)
                if not isinstance(data, list):
                    skipped += 1
                    continue
                messages = [m for m in data if isinstance(m, dict)]
                self._index_session_messages_sync(sid, messages)
                indexed += 1
            except Exception:
                errors += 1
        return {"indexed": indexed, "skipped": skipped, "errors": errors}

    def _neighbor_context_sync(
        self,
        conn: sqlite3.Connection | None,
        session_id: str,
        row_id: int,
        window: int = 1,
    ) -> tuple[str, str]:
        """Load one message before/after by id order within the same session (lightweight context)."""
        own = conn
        close_own = False
        if own is None:
            own = self._connect()
            close_own = True
        try:
            before = own.execute(
                """
                SELECT content FROM session_messages
                WHERE session_id = ? AND id < ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (session_id, row_id, window),
            ).fetchall()
            after = own.execute(
                """
                SELECT content FROM session_messages
                WHERE session_id = ? AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (session_id, row_id, window),
            ).fetchall()
        finally:
            if close_own:
                own.close()
        def _join(rows: List[sqlite3.Row]) -> str:
            texts = [str(r["content"] or "") for r in rows]
            merged = " \n---\n ".join(texts)
            return merged if len(merged) <= 1200 else merged[:1200] + "…"

        return _join(list(before)), _join(list(after))

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
            c4 = conn.execute("DELETE FROM session_messages WHERE session_id = ?", (sid,)).rowcount
            conn.commit()
        return (c1 + c2 + c3 + c4) > 0

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
            if summaries is not None:
                return True
            msgs = conn.execute("SELECT 1 FROM session_messages WHERE session_id = ? LIMIT 1", (sid,)).fetchone()
            return msgs is not None

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
