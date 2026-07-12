#!/usr/bin/env python3
"""Tests for SessionStore persistence.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest

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


def test_session_store_round_trips_typed_scratchpad_values(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    session_id = "typed-scratchpad"
    scratchpad = {
        "text": "plain",
        "mapping": {"detector": "streamed_tool_call_truncated", "ts": 1.5},
        "items": ["one", 2, False],
        "integer": 3,
        "float": 4.5,
        "enabled": True,
        "empty": None,
    }

    store._save_scratchpad_sync(session_id, scratchpad)

    assert store._load_scratchpad_sync(session_id) == scratchpad


def test_session_store_loads_legacy_plain_scratchpad_as_string(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    with store._connect() as conn:
        conn.execute(
            """
            INSERT INTO scratchpad (session_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            ("legacy-session", "legacy-key", "1", "2026-07-12T00:00:00+00:00"),
        )
        conn.commit()

    assert store._load_scratchpad_sync("legacy-session") == {"legacy-key": "1"}


def test_session_store_reports_invalid_scratchpad_key_without_data_loss(
    tmp_path: Path,
) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    store._save_scratchpad_sync("invalid-session", {"stable": "value"})

    with pytest.raises(TypeError, match="bad-value"):
        store._save_scratchpad_sync("invalid-session", {"bad-value": {1, 2}})

    assert store._load_scratchpad_sync("invalid-session") == {"stable": "value"}


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
