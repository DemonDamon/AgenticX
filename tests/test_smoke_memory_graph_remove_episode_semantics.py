#!/usr/bin/env python3
"""Probe tests for graphiti remove_episode semantics (mocked).

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.memory.graph.store import _EPISODE_IMPACT_NOTE, MemoryGraphStore


@pytest.mark.asyncio
async def test_preview_episode_impact_returns_honest_note(monkeypatch):
    class _Store(MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            return None

        async def _get_episode_subgraph_impl(self, group_id: str, episode_uuid: str):
            return {
                "nodes": [{"id": "n1"}, {"id": "n2"}],
                "edges": [{"id": "e1"}],
                "meta": {"groupId": group_id},
            }

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    impact = await store.preview_episode_impact("meta_default", "ep-1")
    assert impact["nodeCount"] == 2
    assert impact["edgeCount"] == 1
    assert impact["note"] == _EPISODE_IMPACT_NOTE
    assert "shared" in impact["note"].lower()


@pytest.mark.asyncio
async def test_delete_episode_calls_graphiti_remove_episode(monkeypatch):
    removed: list[str] = []

    class _Graphiti:
        async def remove_episode(self, episode_uuid: str) -> None:
            removed.append(episode_uuid)

    store = MemoryGraphStore()
    store._ready = True
    store._graphiti = _Graphiti()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    await store.delete_episode("uuid-abc")
    assert removed == ["uuid-abc"]
