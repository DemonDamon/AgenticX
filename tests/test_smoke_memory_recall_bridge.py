#!/usr/bin/env python3
"""Smoke tests for unified memory recall (workspace + graph bridge).

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from agenticx.memory.graph.config import MemoryGraphConfig
from agenticx.memory.recall import (
    _graph_view_to_recall_rows,
    _merge_recall_results,
    search_memory_for_chat,
)
from agenticx.memory.workspace_memory import WorkspaceMemoryStore


def test_graph_view_to_recall_rows() -> None:
    view = {
        "nodes": [{"id": "n1", "label": "黑夜传说", "summary": "电影系列"}],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2",
                "label": "MENTIONS",
            }
        ],
    }
    rows = _graph_view_to_recall_rows(view)
    assert len(rows) == 2
    assert rows[0]["source"] == "graph"
    assert rows[0]["graph_kind"] == "node"
    assert "黑夜传说" in rows[0]["text"]


def test_merge_recall_results_respects_graph_limit() -> None:
    workspace = [
        {"id": "w1", "text": "workspace one", "score": 0.0},
        {"id": "w2", "text": "workspace two", "score": 0.0},
        {"id": "w3", "text": "workspace three", "score": 0.0},
    ]
    graph = [
        {"id": "g1", "text": "graph one", "source": "graph", "score": 0.0},
        {"id": "g2", "text": "graph two", "source": "graph", "score": 0.0},
    ]
    merged = _merge_recall_results(workspace, graph, limit=5, graph_limit=1)
    sources = [row.get("source") for row in merged]
    assert sources.count("graph") <= 1
    assert "workspace" in sources


@pytest.mark.asyncio
async def test_search_memory_for_chat_workspace_only(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text(
        "# MEMORY.md\n- 用户喜欢《黑夜传说》\n",
        encoding="utf-8",
    )
    db_path = tmp_path / "main.sqlite"

    cfg = MemoryGraphConfig(enabled=False, search_in_chat=True)

    with patch("agenticx.memory.recall.WorkspaceMemoryStore") as store_cls:
        real_store = WorkspaceMemoryStore(db_path)
        real_store.index_workspace_sync(workspace)
        store_cls.return_value = real_store

        with patch("agenticx.memory.graph.config.load_memory_graph_config", return_value=cfg):
            result = await search_memory_for_chat("黑夜传说", limit=3)

    assert result.matches
    assert all(row.get("source") == "workspace" for row in result.matches)
    assert any("黑夜传说" in row["text"] for row in result.matches)
    assert result.graph_skipped_reason is None


@pytest.mark.asyncio
async def test_search_memory_for_chat_merges_graph(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "MEMORY.md").write_text("# MEMORY.md\n- note\n", encoding="utf-8")
    db_path = tmp_path / "main.sqlite"

    cfg = MemoryGraphConfig(enabled=True, search_in_chat=True, search_in_chat_graph_limit=2)
    graph_view = {
        "nodes": [{"id": "n1", "label": "黑夜传说", "summary": ""}],
        "edges": [],
    }

    with patch("agenticx.memory.recall.WorkspaceMemoryStore") as store_cls:
        real_store = WorkspaceMemoryStore(db_path)
        real_store.index_workspace_sync(workspace)
        store_cls.return_value = real_store

        with patch("agenticx.memory.graph.config.load_memory_graph_config", return_value=cfg):
            with patch("agenticx.memory.graph.store.MemoryGraphStore") as graph_cls:
                graph_cls.return_value.search_subgraph = AsyncMock(return_value=graph_view)
                result = await search_memory_for_chat("黑夜传说", limit=5)

    sources = {row.get("source") for row in result.matches}
    assert "workspace" in sources
    assert "graph" in sources


@pytest.mark.asyncio
async def test_search_memory_for_chat_graph_disabled_by_config(tmp_path: Path) -> None:
    cfg = MemoryGraphConfig(enabled=True, search_in_chat=False)

    with patch("agenticx.memory.recall.WorkspaceMemoryStore") as store_cls:
        store_cls.return_value.search_sync.return_value = [
            {"id": "w1", "text": "hello", "score": 1.0},
        ]
        with patch("agenticx.memory.graph.config.load_memory_graph_config", return_value=cfg):
            with patch("agenticx.memory.graph.store.MemoryGraphStore") as graph_cls:
                result = await search_memory_for_chat("hello", limit=3)
                graph_cls.assert_not_called()

    assert result.matches
    assert all(row.get("source") == "workspace" for row in result.matches)


@pytest.mark.asyncio
async def test_search_memory_for_chat_graph_failure_fallback() -> None:
    from agenticx.memory.graph.store import MemoryGraphUnavailableError

    cfg = MemoryGraphConfig(enabled=True, search_in_chat=True)

    with patch("agenticx.memory.recall.WorkspaceMemoryStore") as store_cls:
        store_cls.return_value.search_sync.return_value = [
            {"id": "w1", "text": "workspace hit", "score": 1.0},
        ]
        with patch("agenticx.memory.graph.config.load_memory_graph_config", return_value=cfg):
            with patch("agenticx.memory.graph.store.MemoryGraphStore") as graph_cls:
                graph_cls.return_value.search_subgraph = AsyncMock(
                    side_effect=MemoryGraphUnavailableError("graph offline")
                )
                result = await search_memory_for_chat("test", limit=3)

    assert result.matches
    assert result.graph_skipped_reason == "graph offline"
