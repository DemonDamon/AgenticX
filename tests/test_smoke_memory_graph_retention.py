#!/usr/bin/env python3
"""Smoke tests for memory graph retention selection and prune.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from agenticx.memory.graph.config import load_memory_graph_config
from agenticx.memory.graph.retention import select_episodes_for_prune


def _ep(ep_id: str, days_ago: int) -> dict:
    ref = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {"id": ep_id, "referenceTime": ref.isoformat()}


def test_select_episodes_for_prune_respects_max_episodes():
    episodes = [_ep(f"e{i}", i) for i in range(6)]
    to_delete, kept = select_episodes_for_prune(
        episodes,
        max_episodes=3,
        max_age_days=0,
        pinned=set(),
    )
    assert kept == 3
    assert len(to_delete) == 3
    assert "e0" not in to_delete
    assert "e1" not in to_delete
    assert "e2" not in to_delete
    assert "e3" in to_delete
    assert "e4" in to_delete
    assert "e5" in to_delete


def test_select_episodes_for_prune_respects_max_age():
    episodes = [_ep("old", 40), _ep("new", 2)]
    to_delete, kept = select_episodes_for_prune(
        episodes,
        max_episodes=0,
        max_age_days=30,
        pinned=set(),
    )
    assert to_delete == ["old"]
    assert kept == 1


def test_select_episodes_for_prune_skips_pinned():
    episodes = [_ep(f"e{i}", i) for i in range(5)]
    to_delete, kept = select_episodes_for_prune(
        episodes,
        max_episodes=2,
        max_age_days=0,
        pinned={"e0"},
    )
    assert "e0" not in to_delete
    assert kept >= 2


def test_retention_disabled_by_default_in_config(monkeypatch):
    monkeypatch.delenv("AGX_MEMORY_GRAPH_RETENTION", raising=False)
    cfg = load_memory_graph_config()
    assert cfg.retention.enabled is False


@pytest.mark.asyncio
async def test_prune_episodes_dry_run(monkeypatch):
    from agenticx.memory.graph import store as store_mod

    MemoryGraphStore = store_mod.MemoryGraphStore

    class _Store(MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            return None

        async def _list_episodes_impl(self, group_id: str, *, last_n: int = 20):
            return [_ep("a", 10), _ep("b", 1), _ep("c", 0)]

        async def _delete_episode_impl(self, episode_uuid: str) -> None:
            raise AssertionError("dry_run must not delete")

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    result = await store.prune_episodes("meta_default", max_episodes=2, max_age_days=0, dry_run=True)
    assert result["count"] == 1
    assert result["would_delete"] == ["a"]
