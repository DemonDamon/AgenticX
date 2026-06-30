#!/usr/bin/env python3
"""Smoke tests for memory graph Kuzu auto-recovery.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory.graph.graph_recovery import (
    find_latest_backup,
    is_kuzu_corruption_error,
    is_kuzu_lock_error,
)


def test_is_kuzu_corruption_error_detects_io_exception():
    exc = RuntimeError(
        "IO exception: Cannot read from file: /tmp/graph.kuzu "
        "position: 15772655968256"
    )
    assert is_kuzu_corruption_error(exc) is True


def test_user_facing_graph_error_hides_technical_io():
    from agenticx.memory.graph.graph_recovery import user_facing_graph_error

    msg = user_facing_graph_error(
        RuntimeError(
            "IO exception: Cannot read from file: /tmp/graph.kuzu position: 15772655968256"
        )
    )
    assert "cp" not in msg
    assert "pkill" not in msg
    assert "自动修复" in msg


def test_is_corruption_message():
    from agenticx.memory.graph.graph_recovery import is_corruption_message

    assert is_corruption_message("IO exception: Cannot read from file")
    assert not is_corruption_message("Could not set lock on file")
    exc = RuntimeError("Could not set lock on file: /tmp/graph.kuzu")
    assert is_kuzu_lock_error(exc) is True
    assert is_kuzu_corruption_error(exc) is False


def test_find_latest_backup_picks_newest(tmp_path: Path):
    db = tmp_path / "graph.kuzu"
    older = tmp_path / "graph.kuzu.bak-20260101T000000Z"
    newer = tmp_path / "graph.kuzu.bak-20260201T000000Z"
    wal = tmp_path / "graph.kuzu.bak-20260201T000000Z.wal"
    older.write_bytes(b"old")
    newer.write_bytes(b"new")
    wal.write_bytes(b"x")
    assert find_latest_backup(db) == newer


def test_recover_corrupt_graph_db_restores_valid_backup(tmp_path: Path, monkeypatch):
    pytest.importorskip("kuzu")

    db_path = tmp_path / "graph.kuzu"
    backup = tmp_path / "graph.kuzu.bak-20260101T000000Z"

    import kuzu

    good_db = kuzu.Database(str(backup))
    conn = kuzu.Connection(good_db)
    conn.execute("CREATE NODE TABLE T(id INT64, PRIMARY KEY(id))")
    conn.execute("CREATE (n:T {id: 1})")
    if hasattr(good_db, "close"):
        good_db.close()

    db_path.write_bytes(b"corrupt")

    cfg = type(
        "Cfg",
        (),
        {
            "db_path": db_path,
            "status_path": tmp_path / "graph_ingest.json",
            "ingest": type("I", (), {"semaphore_limit": 1})(),
            "telemetry": False,
            "llm": type("L", (), {"provider": "openai", "model": "gpt-4o-mini"})(),
            "embedder": type(
                "E", (), {"provider": "openai", "model": "text-embedding-3-small"}
            )(),
        },
    )()

    async def _fake_build_empty_schema(new_path: str, cfg: object) -> None:
        empty = kuzu.Database(new_path)
        c = kuzu.Connection(empty)
        c.execute("CREATE NODE TABLE T(id INT64, PRIMARY KEY(id))")
        if hasattr(empty, "close"):
            empty.close()

    monkeypatch.setattr(
        "agenticx.memory.graph.graph_rebuild._build_empty_schema",
        _fake_build_empty_schema,
    )

    from agenticx.memory.graph.graph_recovery import recover_corrupt_graph_db

    result = recover_corrupt_graph_db(cfg)
    assert result["action"] == "restored_from_backup"
    assert result["backup"] == str(backup)
    assert db_path.exists()
    ok_db = kuzu.Database(str(db_path), read_only=True)
    ok_conn = kuzu.Connection(ok_db)
    rows = []
    r = ok_conn.execute("MATCH (n:T) RETURN n.id")
    while r.has_next():
        rows.append(r.get_next())
    assert rows == [[1]]
