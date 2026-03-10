#!/usr/bin/env python3
"""Tests for WorkspaceMemoryStore indexing and search.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def test_workspace_memory_fts_and_semantic_search(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    memory_dir = workspace / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text("# MEMORY.md\n- user likes python testing\n", encoding="utf-8")
    (workspace / "IDENTITY.md").write_text("# IDENTITY.md\n- Agent identity\n", encoding="utf-8")
    (workspace / "USER.md").write_text("# USER.md\n- Name: Damon\n", encoding="utf-8")
    (workspace / "SOUL.md").write_text("# SOUL.md\n- concise\n", encoding="utf-8")
    (memory_dir / "2026-03-10.md").write_text("# Daily Memory\n- Notes:\n  - fixed sqlite index issue\n", encoding="utf-8")

    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    stats = store.index_workspace_sync(workspace)
    assert stats["total_files"] >= 4

    fts_rows = store.search_sync("sqlite", mode="fts", limit=5)
    assert fts_rows
    assert any("sqlite" in row["text"] for row in fts_rows)

    semantic_rows = store.search_sync("python tests", mode="semantic", limit=5)
    assert semantic_rows


def test_workspace_memory_incremental_index(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    memory_file = workspace / "MEMORY.md"
    memory_file.write_text("# MEMORY.md\n- first version\n", encoding="utf-8")

    store = WorkspaceMemoryStore(tmp_path / "main.sqlite")
    first = store.index_file_sync(memory_file)
    second = store.index_workspace_sync(workspace)
    assert first >= 1
    assert second["skipped_files"] >= 1

    memory_file.write_text("# MEMORY.md\n- second version with keyword banana\n", encoding="utf-8")
    changed = store.index_file_sync(memory_file)
    assert changed >= 1
    rows = store.search_sync("banana", mode="fts", limit=3)
    assert rows
