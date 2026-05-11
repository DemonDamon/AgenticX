#!/usr/bin/env python3
"""Persist LLM usage events to ~/.agenticx/usage.sqlite for dashboards.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from agenticx.runtime.model_pricing import compute_cost_usd

_log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms INTEGER NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    avatar_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts_ms);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_usage_prov_model_ts ON usage_events(provider, model, ts_ms);
"""


class UsageStore:
    """Thread-safe SQLite usage ledger."""

    def __init__(self, db_path: Path | None = None) -> None:
        self._path = db_path or (Path.home() / ".agenticx" / "usage.sqlite")
        self._lock = threading.Lock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._path), timeout=60.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(_SCHEMA)
                conn.commit()
            finally:
                conn.close()

    def record_sync(
        self,
        *,
        session_id: str,
        avatar_id: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int,
        reasoning_tokens: int,
        total_tokens: int,
    ) -> None:
        sid = (session_id or "").strip()
        aid = (avatar_id or "").strip()
        prov = (provider or "").strip().lower()
        mdl = (model or "").strip()
        inp = max(0, int(input_tokens or 0))
        out = max(0, int(output_tokens or 0))
        cached = max(0, int(cached_tokens or 0))
        reasoning = max(0, int(reasoning_tokens or 0))
        total = max(0, int(total_tokens or 0))
        if inp == 0 and out == 0 and total == 0 and cached == 0 and reasoning == 0:
            return
        cost = compute_cost_usd(mdl, input_tokens=inp, output_tokens=out, cached_tokens=cached)
        ts_ms = int(time.time() * 1000)
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO usage_events (
                        ts_ms, session_id, avatar_id, provider, model,
                        input_tokens, output_tokens, cached_tokens, reasoning_tokens,
                        total_tokens, cost_usd
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (ts_ms, sid, aid, prov, mdl, inp, out, cached, reasoning, total, cost),
                )
                conn.commit()
            finally:
                conn.close()

    async def record_async(
        self,
        *,
        session_id: str,
        avatar_id: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int,
        reasoning_tokens: int,
        total_tokens: int,
    ) -> None:
        try:
            await asyncio.to_thread(
                self.record_sync,
                session_id=session_id,
                avatar_id=avatar_id,
                provider=provider,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cached_tokens=cached_tokens,
                reasoning_tokens=reasoning_tokens,
                total_tokens=total_tokens,
            )
        except Exception as exc:
            _log.warning("usage_store.record_async failed: %s", exc)

    def summary_sync(self, start_ms: int, end_ms: int) -> dict[str, Any]:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT
                        COALESCE(SUM(total_tokens), 0),
                        COALESCE(SUM(input_tokens), 0),
                        COALESCE(SUM(output_tokens), 0),
                        COALESCE(SUM(cached_tokens), 0),
                        COALESCE(SUM(reasoning_tokens), 0),
                        COALESCE(SUM(cost_usd), 0),
                        COUNT(DISTINCT CASE WHEN session_id != '' THEN session_id END)
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ?
                    """,
                    (start_ms, end_ms),
                ).fetchone()
            finally:
                conn.close()
        if not row:
            return {
                "tokens": 0,
                "input": 0,
                "output": 0,
                "cached": 0,
                "reasoning": 0,
                "cost_usd": 0.0,
                "conversations": 0,
            }
        return {
            "tokens": int(row[0] or 0),
            "input": int(row[1] or 0),
            "output": int(row[2] or 0),
            "cached": int(row[3] or 0),
            "reasoning": int(row[4] or 0),
            "cost_usd": float(row[5] or 0.0),
            "conversations": int(row[6] or 0),
        }

    def breakdown_sync(
        self,
        start_ms: int,
        end_ms: int,
        *,
        dimension: str,
    ) -> list[dict[str, Any]]:
        dim = (dimension or "provider").strip().lower()
        with self._lock:
            conn = self._connect()
            try:
                if dim == "model":
                    rows = conn.execute(
                        """
                        SELECT model,
                               SUM(total_tokens),
                               SUM(cost_usd)
                        FROM usage_events
                        WHERE ts_ms >= ? AND ts_ms <= ? AND model != ''
                        GROUP BY model
                        ORDER BY SUM(total_tokens) DESC
                        """,
                        (start_ms, end_ms),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT provider,
                               SUM(total_tokens),
                               SUM(cost_usd),
                               COUNT(DISTINCT CASE WHEN model != '' THEN model END)
                        FROM usage_events
                        WHERE ts_ms >= ? AND ts_ms <= ?
                        GROUP BY provider
                        ORDER BY SUM(total_tokens) DESC
                        """,
                        (start_ms, end_ms),
                    ).fetchall()
            finally:
                conn.close()
        total_tokens = sum(int(r[1] or 0) for r in rows)
        out: list[dict[str, Any]] = []
        for r in rows:
            key = str(r[0] or "(unknown)")
            tks = int(r[1] or 0)
            cst = float(r[2] or 0.0)
            pct = (100.0 * tks / total_tokens) if total_tokens > 0 else 0.0
            item: dict[str, Any] = {
                "key": key,
                "tokens": tks,
                "percent": round(pct, 2),
                "cost_usd": round(cst, 4),
            }
            if dim != "model" and len(r) > 3:
                item["model_count"] = int(r[3] or 0)
            out.append(item)
        return out

    def daily_sync(self, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT
                        strftime('%Y-%m-%d', ts_ms / 1000, 'unixepoch') AS d,
                        SUM(total_tokens),
                        SUM(input_tokens),
                        SUM(output_tokens),
                        SUM(cached_tokens),
                        SUM(reasoning_tokens),
                        COUNT(DISTINCT CASE WHEN session_id != '' THEN session_id END)
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ?
                    GROUP BY d
                    ORDER BY d ASC
                    """,
                    (start_ms, end_ms),
                ).fetchall()
            finally:
                conn.close()
        return [
            {
                "date": str(r[0] or ""),
                "total": int(r[1] or 0),
                "input": int(r[2] or 0),
                "output": int(r[3] or 0),
                "cached": int(r[4] or 0),
                "reasoning": int(r[5] or 0),
                "convs": int(r[6] or 0),
            }
            for r in rows
        ]

    def heatmap_sync(self, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        """Daily totals for heatmap visualization."""
        return [{"date": row["date"], "total": row["total"]} for row in self.daily_sync(start_ms, end_ms)]

    def top_models_sync(self, start_ms: int, end_ms: int, limit: int = 3) -> list[dict[str, Any]]:
        lim = max(1, min(20, int(limit or 3)))
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT model, SUM(total_tokens) AS t
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ? AND model != ''
                    GROUP BY model
                    ORDER BY t DESC
                    LIMIT ?
                    """,
                    (start_ms, end_ms, lim),
                ).fetchall()
                total_row = conn.execute(
                    """
                    SELECT COALESCE(SUM(total_tokens), 0)
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ?
                    """,
                    (start_ms, end_ms),
                ).fetchone()
            finally:
                conn.close()
        grand = int(total_row[0] or 0) if total_row else 0
        out: list[dict[str, Any]] = []
        for r in rows:
            m = str(r[0] or "")
            tks = int(r[1] or 0)
            pct = (100.0 * tks / grand) if grand > 0 else 0.0
            out.append({"model": m, "tokens": tks, "percent": round(pct, 2)})
        return out

    def started_at_sync(self) -> int | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute("SELECT MIN(ts_ms) FROM usage_events").fetchone()
            finally:
                conn.close()
        if not row or row[0] is None:
            return None
        return int(row[0])

    def active_days_sync(self, start_ms: int, end_ms: int) -> int:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT COUNT(DISTINCT strftime('%Y-%m-%d', ts_ms / 1000, 'unixepoch'))
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ?
                    """,
                    (start_ms, end_ms),
                ).fetchone()
            finally:
                conn.close()
        return int(row[0] or 0) if row else 0

    def month_conversations_sync(self, start_ms: int, end_ms: int) -> int:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT COUNT(DISTINCT session_id)
                    FROM usage_events
                    WHERE ts_ms >= ? AND ts_ms <= ? AND session_id != ''
                    """,
                    (start_ms, end_ms),
                ).fetchone()
            finally:
                conn.close()
        return int(row[0] or 0) if row else 0


_store_singleton: UsageStore | None = None
_store_lock = threading.Lock()


def get_usage_store() -> UsageStore:
    global _store_singleton
    with _store_lock:
        if _store_singleton is None:
            _store_singleton = UsageStore()
        return _store_singleton
