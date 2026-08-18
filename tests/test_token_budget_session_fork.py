#!/usr/bin/env python3
"""Token-budget isolation for forked Studio sessions.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.memory import session_store as session_store_module
from agenticx.memory.session_store import SessionStore
from agenticx.runtime.token_budget import TOKEN_BUDGET_SCRATCHPAD_KEY
from agenticx.studio.session_manager import SessionManager


def _temp_manager(tmp_path: Path, monkeypatch) -> tuple[SessionManager, SessionStore, Path]:
    sessions_root = tmp_path / "sessions"
    db_path = tmp_path / "sessions.sqlite"
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(session_store_module, "DEFAULT_SESSION_DB_PATH", db_path)
    manager = SessionManager()
    store = manager._session_store
    manager._sessions_root = str(sessions_root)
    return manager, store, sessions_root


def test_fork_keeps_normal_scratchpad_but_resets_token_usage(tmp_path: Path, monkeypatch) -> None:
    manager, _store, _sessions_root = _temp_manager(tmp_path, monkeypatch)

    source = manager.create(session_id="source")
    source.studio_session.scratchpad = {
        "project_note": "keep me",
        TOKEN_BUDGET_SCRATCHPAD_KEY: {
            "version": 1,
            "cumulative_input": 600_000,
            "cumulative_output": 50_000,
            "warning_emitted": True,
        },
    }

    forked = manager.fork_session(source.session_id)

    assert forked is not None
    assert forked.studio_session.scratchpad["project_note"] == "keep me"
    assert TOKEN_BUDGET_SCRATCHPAD_KEY not in forked.studio_session.scratchpad
    assert TOKEN_BUDGET_SCRATCHPAD_KEY in source.studio_session.scratchpad


def test_token_usage_payload_survives_full_session_persist_and_reload(tmp_path: Path, monkeypatch) -> None:
    manager, store, sessions_root = _temp_manager(tmp_path, monkeypatch)

    payload = {
        "version": 1,
        "cumulative_input": 612_345,
        "cumulative_output": 67_890,
        "warning_emitted": True,
    }
    source = manager.create(session_id="persisted-token-budget")
    source.studio_session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = payload
    assert manager.persist(source.session_id) is True

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    restored = fresh.get(source.session_id, touch=False)

    assert restored is not None
    assert restored.studio_session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] == payload
