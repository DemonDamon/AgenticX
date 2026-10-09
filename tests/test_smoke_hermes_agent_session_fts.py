"""Smoke tests for session message FTS5 (hermes-agent codegen G1 / feat-1a)."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory import session_store as session_store_mod
from agenticx.memory.session_store import SessionStore, session_fts_enabled


def test_session_fts_three_sessions_happy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    db = tmp_path / "sessions.sqlite"
    store = SessionStore(db_path=db)
    for i in range(3):
        sid = f"session-{i}"
        msgs = [{"role": "user", "content": f"hello session {i} uniquekw{i}xy"} for _ in range(5)]
        assert store._index_session_messages_sync(sid, msgs) == 5
    hits = store._search_session_messages_sync("uniquekw1xy", None, 50)
    sids = {h["session_id"] for h in hits}
    assert "session-1" in sids
    assert "session-0" not in sids and "session-2" not in sids


def test_session_fts_empty_query_returns_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    store = SessionStore(db_path=tmp_path / "s.sqlite")
    store._index_session_messages_sync("a", [{"role": "user", "content": "hello"}])
    assert store._search_session_messages_sync("", None, 10) == []
    assert store._search_session_messages_sync("   ", None, 10) == []


def test_session_fts_special_chars_no_crash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    store = SessionStore(db_path=tmp_path / "s.sqlite")
    store._index_session_messages_sync("a", [{"role": "user", "content": "safe text here"}])
    _ = store._search_session_messages_sync('")(+{}^***', None, 10)
    _ = store._search_session_messages_sync("AND OR NOT", None, 10)


def test_session_fts_disabled_noop_and_empty_search(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "0")
    assert not session_fts_enabled()
    store = SessionStore(db_path=tmp_path / "s.sqlite")
    assert store._index_session_messages_sync("a", [{"role": "user", "content": "hello"}]) == 0
    assert store._search_session_messages_sync("hello", None, 10) == []


def test_sanitize_fts5_query_strips_operational_noise() -> None:
    q = session_store_mod._sanitize_fts5_query('foo "bar baz"')
    assert "bar baz" in q or "foo" in q


def test_index_session_messages_is_incremental(tmp_path) -> None:
    """Persist only rewrites rows after the unchanged prefix (FTS bloat / CPU fix)."""
    from agenticx.memory.session_store import SessionStore

    store = SessionStore(db_path=tmp_path / "fts.sqlite")

    def ids_and_contents():
        with store._connect() as conn:
            return [
                (r["id"], r["content"])
                for r in conn.execute(
                    "SELECT id, content FROM session_messages WHERE session_id='s' ORDER BY id"
                ).fetchall()
            ]

    msgs = [
        {"role": "user", "content": "alpha banana", "timestamp": 1.0},
        {"role": "assistant", "content": "cherry", "timestamp": 2.0},
    ]
    store._index_session_messages_sync("s", msgs)
    first = ids_and_contents()

    store._index_session_messages_sync("s", msgs)
    assert ids_and_contents() == first, "unchanged history must not rewrite rows"

    msgs.append({"role": "user", "content": "durian", "timestamp": 3.0})
    store._index_session_messages_sync("s", msgs)
    after_append = ids_and_contents()
    assert after_append[:2] == first, "prefix rows keep their ids"
    assert after_append[2][1] == "durian"

    msgs[1] = {"role": "assistant", "content": "cherry edited", "timestamp": 2.0}
    store._index_session_messages_sync("s", msgs)
    after_edit = ids_and_contents()
    assert after_edit[0] == first[0]
    assert [c for _, c in after_edit] == ["alpha banana", "cherry edited", "durian"]

    store._index_session_messages_sync("s", msgs[:1])
    assert [c for _, c in ids_and_contents()] == ["alpha banana"]

    hits = store._search_session_messages_sync("banana", None, 10)
    assert hits and hits[0]["session_id"] == "s"
    assert not store._search_session_messages_sync("durian", None, 10), "deleted tail must leave the FTS index"


def test_backfill_rebuilds_inconsistent_fts_index(tmp_path) -> None:
    """Orphaned FTS entries (index ≠ content) are detected and rebuilt on backfill."""
    import sqlite3

    from agenticx.memory.session_store import SessionStore

    store = SessionStore(db_path=tmp_path / "fts.sqlite")
    store._index_session_messages_sync("s", [{"role": "user", "content": "orphan kiwi", "timestamp": 1.0}])
    # Simulate a historical delete that bypassed the FTS trigger.
    with store._connect() as conn:
        conn.execute("DROP TRIGGER session_messages_ad")
        conn.execute("DELETE FROM session_messages WHERE session_id='s'")
    store._ensure_schema()
    raw = sqlite3.connect(tmp_path / "fts.sqlite")
    try:
        raw.execute("INSERT INTO session_messages_fts(session_messages_fts, rank) VALUES('integrity-check', 1)")
        consistent = True
    except sqlite3.DatabaseError:
        consistent = False
    raw.close()
    assert not consistent

    sessions_root = tmp_path / "sessions"
    sessions_root.mkdir()
    result = store._backfill_from_sessions_root_sync(sessions_root)
    assert result.get("fts_rebuilt") is True
    assert store._repair_fts_index_if_inconsistent_sync() is False
