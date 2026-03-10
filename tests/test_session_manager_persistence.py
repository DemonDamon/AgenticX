#!/usr/bin/env python3
"""Tests for SessionManager state restore/save.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.memory.session_store import SessionStore
from agenticx.studio.session_manager import SessionManager


def test_session_manager_restores_and_persists(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store  # test override

    sid = "fixed-session-id"
    store._save_todos_sync(
        sid,
        [{"content": "task", "status": "in_progress", "active_form": "doing"}],
    )
    store._save_scratchpad_sync(sid, {"k": "v"})

    managed = manager.create(session_id=sid)
    assert managed.studio_session.todo_manager.items
    assert managed.studio_session.scratchpad.get("k") == "v"

    managed.studio_session.scratchpad["k2"] = "v2"
    assert manager.delete(sid) is True
    restored = store._load_scratchpad_sync(sid)
    assert restored.get("k2") == "v2"
