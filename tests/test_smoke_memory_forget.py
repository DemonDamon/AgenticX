#!/usr/bin/env python3
"""Smoke tests for memory_forget tool helper.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory.graph.forget import forget_memory_for_session
from agenticx.workspace.loader import append_long_term_memory


@pytest.mark.asyncio
async def test_forget_empty_query_does_not_delete():
    result = await forget_memory_for_session("", scope="both")
    assert result.get("ok") is False


@pytest.mark.asyncio
async def test_forget_text_matches_and_deletes(tmp_path, monkeypatch):
    ws = tmp_path / "workspace"
    ws.mkdir()
    append_long_term_memory(ws, "User likes Kimi assistant", section="Notes")
    monkeypatch.setattr(
        "agenticx.memory.graph.forget.resolve_subject_workspace_dir",
        lambda **kwargs: ws,
    )

    class _Store:
        async def list_episodes(self, group_id, last_n=100):
            return []

        async def search_subgraph(self, group_id, query, **kwargs):
            return {"nodes": [], "edges": []}

        async def delete_episodes_bulk(self, group_id, episode_uuids):
            return {"deleted": [], "skipped_pinned": [], "count": 0}

    monkeypatch.setattr(
        "agenticx.memory.graph.forget.MemoryGraphStore",
        type("M", (), {"singleton": classmethod(lambda cls: _Store())}),
    )

    result = await forget_memory_for_session("Kimi", scope="text", avatar_id=None)
    assert result.get("ok") is True
    assert result.get("deleted_text", 0) >= 1


@pytest.mark.asyncio
async def test_forget_no_match_returns_message(monkeypatch):
    class _Store:
        async def list_episodes(self, group_id, last_n=100):
            return [{"id": "e1", "preview": "unrelated topic"}]

        async def search_subgraph(self, group_id, query, **kwargs):
            return {"nodes": [], "edges": []}

        async def delete_episodes_bulk(self, group_id, episode_uuids):
            return {"deleted": [], "skipped_pinned": [], "count": 0}

    monkeypatch.setattr(
        "agenticx.memory.graph.forget.MemoryGraphStore",
        type("M", (), {"singleton": classmethod(lambda cls: _Store())}),
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.forget.resolve_subject_workspace_dir",
        lambda **kwargs: Path("/tmp/empty-ws"),
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.forget.read_memory_entries",
        lambda _dir: [],
    )

    result = await forget_memory_for_session("missing-topic-xyz", scope="both")
    assert result.get("message") == "未找到匹配记忆"
