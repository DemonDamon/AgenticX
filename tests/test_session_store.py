#!/usr/bin/env python3
"""Tests for SessionStore persistence.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agenticx.memory.session_store import SessionStore


def test_session_store_persists_todos_and_scratchpad(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    session_id = "s1"
    todos = [
        {"content": "task", "status": "in_progress", "active_form": "doing task"},
    ]
    scratchpad = {"k1": "v1", "k2": "v2"}

    asyncio.run(store.save_todos(session_id, todos))
    asyncio.run(store.save_scratchpad(session_id, scratchpad))

    loaded_todos = asyncio.run(store.load_todos(session_id))
    loaded_scratch = asyncio.run(store.load_scratchpad(session_id))
    assert loaded_todos == todos
    assert loaded_scratch == scratchpad


def test_session_store_summary_search(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    asyncio.run(
        store.save_session_summary(
            "s2",
            "fixed auth bug and added tests",
            {"provider": "x"},
        )
    )
    rows = asyncio.run(store.search_session_summaries("auth", limit=5))
    assert rows
    assert "auth" in rows[0]["summary"]


def test_session_summary_history_is_bounded(tmp_path: Path) -> None:
    """Repeated persists for one session must not grow unbounded; only the most
    recent _SUMMARY_HISTORY_KEEP rows are retained (prevents the bloat that
    degraded the session list query)."""
    import sqlite3

    store = SessionStore(tmp_path / "sessions.sqlite")
    keep = SessionStore._SUMMARY_HISTORY_KEEP
    writes = keep + 20
    for i in range(writes):
        asyncio.run(store.save_session_summary("bounded", f"summary v{i}", {"i": i}))

    conn = sqlite3.connect(store.db_path)
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM session_summaries WHERE session_id = ?",
            ("bounded",),
        ).fetchone()[0]
    finally:
        conn.close()
    assert count == keep, f"expected {keep} rows, got {count}"

    # The latest write must still be the one returned for metadata lookups.
    meta = asyncio.run(store.load_latest_session_metadata("bounded"))
    assert meta.get("i") == writes - 1
