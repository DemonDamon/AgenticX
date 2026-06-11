#!/usr/bin/env python3
"""Tests for WorkspaceMemoryStore chunk composite rerank.

Author: Damon Li
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def _legacy_db_path(tmp_path: Path) -> Path:
    """Create a pre-migration SQLite DB without chunk access columns."""
    db_path = tmp_path / "legacy.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE chunks (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            source TEXT,
            start_line INTEGER,
            end_line INTEGER,
            model TEXT,
            text TEXT NOT NULL,
            embedding BLOB,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE VIRTUAL TABLE chunks_fts
        USING fts5(text, path UNINDEXED, source UNINDEXED, content='')
        """
    )
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO chunks (id, path, source, start_line, end_line, model, text, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "ch-legacy001",
            "/tmp/MEMORY.md",
            "MEMORY.md",
            1,
            2,
            "hashing-v1",
            "# MEMORY\n- legacy sqlite keyword alpha",
            None,
            now,
        ),
    )
    conn.execute(
        "INSERT INTO chunks_fts(rowid, text, path, source) VALUES (1, ?, ?, ?)",
        ("# MEMORY\n- legacy sqlite keyword alpha", "/tmp/MEMORY.md", "MEMORY.md"),
    )
    conn.commit()
    conn.close()
    return db_path


def test_legacy_db_migration(tmp_path: Path) -> None:
    db_path = _legacy_db_path(tmp_path)
    store = WorkspaceMemoryStore(db_path)
    with store._connect() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(chunks)").fetchall()}
    assert "access_count" in cols
    assert "last_accessed" in cols

    rows = store.search_sync("sqlite", mode="fts", limit=5)
    assert rows
    assert any("sqlite" in row["text"] for row in rows)


def test_rerank_off_is_identical(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGX_CHUNK_RERANK_ENABLED", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# MEMORY\n- reranktopic alpha note one\n- reranktopic beta note two\n",
        encoding="utf-8",
    )
    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    store.index_workspace_sync(workspace)

    for mode in ("fts", "semantic", "hybrid"):
        direct_fts = store._search_fts("reranktopic", 5)
        direct_sem = store._search_semantic("reranktopic", 5)
        if mode == "fts":
            expected = direct_fts[:3]
        elif mode == "semantic":
            expected = direct_sem[:3]
        else:
            expected = store._merge_ranked(direct_fts, direct_sem)[:3]

        actual = store.search_sync("reranktopic", mode=mode, limit=3)
        assert len(actual) == len(expected)
        for got, want in zip(actual, expected):
            assert got["id"] == want["id"]
            assert got["score"] == want["score"]


def test_rerank_orders_by_recency_frequency(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_CHUNK_RERANK_ENABLED", "1")
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# Fresh Section\n- reranktopic fresh beta line\n\n"
        "# Legacy Section\n- reranktopic legacy alpha line\n",
        encoding="utf-8",
    )
    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    store.index_workspace_sync(workspace)

    before = store.search_sync("reranktopic", mode="fts", limit=2)
    assert len(before) >= 2
    fresh_id = before[0]["id"]
    old_id = before[-1]["id"]
    assert fresh_id != old_id

    old_time = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    with store._connect() as conn:
        conn.execute("UPDATE chunks SET created_at = ? WHERE id = ?", (old_time, old_id))
        conn.execute("UPDATE chunks SET access_count = 8 WHERE id = ?", (old_id,))
        conn.commit()

    after = store.search_sync("reranktopic", mode="fts", limit=2)
    assert after[0]["id"] == old_id
    assert after[0]["id"] != fresh_id


def test_reinforce_increments_access_count(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# MEMORY\n- reinforce keyword chunk test\n",
        encoding="utf-8",
    )
    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    store.index_workspace_sync(workspace)
    rows = store.search_sync("reinforce", mode="fts", limit=1)
    assert rows
    chunk_id = rows[0]["id"]

    store.reinforce_chunks_sync([chunk_id, chunk_id, chunk_id])

    with store._connect() as conn:
        row = conn.execute(
            "SELECT access_count, last_accessed FROM chunks WHERE id = ?",
            (chunk_id,),
        ).fetchone()
    assert row is not None
    assert int(row["access_count"]) == 3
    assert row["last_accessed"]
