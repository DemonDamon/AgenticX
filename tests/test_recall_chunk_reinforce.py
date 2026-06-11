#!/usr/bin/env python3
"""Tests for recall chunk reinforce integration.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from agenticx.memory.recall import search_memory_for_chat
from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def _chunk_access_count(store: WorkspaceMemoryStore, chunk_id: str) -> int:
    with store._connect() as conn:
        row = conn.execute(
            "SELECT access_count FROM chunks WHERE id = ?",
            (chunk_id,),
        ).fetchone()
    assert row is not None
    return int(row["access_count"] or 0)


def test_recall_reinforces_chunks_when_enabled(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_CHUNK_RERANK_ENABLED", "1")
    db_path = tmp_path / "main.sqlite"
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# MEMORY\n- recall reinforce chunk keyword\n",
        encoding="utf-8",
    )
    store = WorkspaceMemoryStore(db_path)
    store.index_workspace_sync(workspace)
    rows = store.search_sync("recall reinforce", mode="fts", limit=1)
    assert rows
    chunk_id = rows[0]["id"]
    before = _chunk_access_count(store, chunk_id)

    with monkeypatch.context() as m:
        m.setattr(
            "agenticx.memory.recall.WorkspaceMemoryStore",
            lambda: WorkspaceMemoryStore(db_path),
        )
        result = asyncio.run(
            search_memory_for_chat("recall reinforce", limit=3, include_turns=False)
        )
        time.sleep(0.2)

    assert any(item.get("source") == "workspace" for item in result.matches)
    after = _chunk_access_count(store, chunk_id)
    assert after > before


def test_recall_skips_chunk_reinforce_when_disabled(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGX_CHUNK_RERANK_ENABLED", raising=False)
    db_path = tmp_path / "main.sqlite"
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# MEMORY\n- recall skip reinforce keyword\n",
        encoding="utf-8",
    )
    store = WorkspaceMemoryStore(db_path)
    store.index_workspace_sync(workspace)
    rows = store.search_sync("skip reinforce", mode="fts", limit=1)
    assert rows
    chunk_id = rows[0]["id"]
    before = _chunk_access_count(store, chunk_id)

    with monkeypatch.context() as m:
        m.setattr(
            "agenticx.memory.recall.WorkspaceMemoryStore",
            lambda: WorkspaceMemoryStore(db_path),
        )
        asyncio.run(
            search_memory_for_chat("skip reinforce", limit=3, include_turns=False)
        )
        time.sleep(0.2)

    after = _chunk_access_count(store, chunk_id)
    assert after == before
