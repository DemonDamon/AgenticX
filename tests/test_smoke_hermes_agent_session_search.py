"""Smoke tests for session_search tool (hermes-agent codegen G1 / feat-1b, 1c)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, _tool_session_search
from agenticx.memory.session_store import SessionStore


def _studio_tool_names() -> set[str]:
    names: set[str] = set()
    for item in STUDIO_TOOLS:
        fn = item.get("function") or {}
        n = fn.get("name")
        if n:
            names.add(str(n))
    return names


def test_session_search_registered_in_studio_tools() -> None:
    assert "session_search" in _studio_tool_names()


def test_tool_session_search_recent_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    db = tmp_path / "s.sqlite"

    def _store() -> SessionStore:
        return SessionStore(db_path=db)

    monkeypatch.setattr("agenticx.cli.agent_tools.SessionStore", lambda *a, **k: _store())
    out = json.loads(_tool_session_search({"query": "", "limit": 3}, None))
    assert out["mode"] == "recent"
    assert "sessions" in out
    assert isinstance(out["sessions"], list)


def test_tool_session_search_happy_grouped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    db = tmp_path / "s.sqlite"
    store = SessionStore(db_path=db)
    store._index_session_messages_sync("s-a", [{"role": "user", "content": "alpha zebrasearch token"}])
    store._index_session_messages_sync("s-b", [{"role": "user", "content": "beta other"}])

    monkeypatch.setattr("agenticx.cli.agent_tools.SessionStore", lambda *a, **k: SessionStore(db_path=db))
    out = json.loads(
        _tool_session_search({"query": "zebrasearch", "limit": 3}, None),
    )
    assert out["mode"] == "search"
    assert len(out["sessions"]) >= 1
    assert out["sessions"][0]["session_id"] == "s-a"
    assert out["sessions"][0]["hits"]


def test_tool_session_search_limit_clamped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_FTS", "1")
    db = tmp_path / "s.sqlite"
    for i in range(6):
        SessionStore(db_path=db)._index_session_messages_sync(
            f"sid{i}", [{"role": "user", "content": f"commonword {i}"}]
        )
    monkeypatch.setattr("agenticx.cli.agent_tools.SessionStore", lambda *a, **k: SessionStore(db_path=db))
    out = json.loads(_tool_session_search({"query": "commonword", "limit": 99}, None))
    assert len(out["sessions"]) <= 5
