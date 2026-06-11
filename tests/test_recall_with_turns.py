#!/usr/bin/env python3
"""Tests for recall integration with archived turns.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from agenticx.memory.recall import search_memory_for_chat
from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def test_recall_includes_turn_matches(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_TURN_ARCHIVE_ENABLED", "1")
    db_path = tmp_path / "main.sqlite"
    store = WorkspaceMemoryStore(db_path)
    store.archive_turn_sync(
        session_id="sess-recall",
        text="[user] ruflo compaction bridge\n[assistant] archive turns before compact",
        turn_index=0,
    )

    with monkeypatch.context() as m:
        m.setattr(
            "agenticx.memory.recall.WorkspaceMemoryStore",
            lambda: WorkspaceMemoryStore(db_path),
        )
        result = asyncio.run(
            search_memory_for_chat(
                "compaction bridge",
                session_id="sess-recall",
                include_turns=True,
                turns_limit=3,
            )
        )

    assert any(item.get("source") == "turn" for item in result.matches)
