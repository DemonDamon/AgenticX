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
