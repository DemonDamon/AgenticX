#!/usr/bin/env python3
"""Tests for WorkspaceMemoryStore turn archive and recall.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path

from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def test_archive_turn_dedup_and_search(tmp_path: Path) -> None:
    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    text = "[user] how to fix sqlite index\n[assistant] rebuild the fts table"
    assert store.archive_turn_sync(session_id="sess-1", text=text, turn_index=1) is True
    assert store.archive_turn_sync(session_id="sess-1", text=text, turn_index=2) is False

    rows = store.search_turns_sync("sqlite index", limit=5, session_id="sess-1")
    assert rows
    assert rows[0]["source"] == "turn"
    assert "sqlite" in rows[0]["text"].lower()


def test_reinforce_turns_boosts_rank(tmp_path: Path) -> None:
    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    old_text = "[user] legacy topic alpha\n[assistant] old answer about alpha"
    new_text = "[user] fresh topic beta\n[assistant] new answer about beta"
    store.archive_turn_sync(session_id="sess-2", text=old_text, turn_index=0)
    store.archive_turn_sync(session_id="sess-2", text=new_text, turn_index=1)

    before = store.search_turns_sync("topic", limit=2, session_id="sess-2")
    assert len(before) >= 1
    old_id = before[-1]["id"]

    store.reinforce_turns_sync([old_id])
    store.reinforce_turns_sync([old_id])
    store.reinforce_turns_sync([old_id])

    after = store.search_turns_sync("topic", limit=2, session_id="sess-2")
    assert after[0]["id"] == old_id
