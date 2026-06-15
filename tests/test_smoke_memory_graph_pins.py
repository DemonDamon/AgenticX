#!/usr/bin/env python3
"""Smoke tests for memory graph episode pins.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.memory.graph import pins as pins_mod
from agenticx.memory.graph.retention import select_episodes_for_prune


def test_pins_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(pins_mod, "DEFAULT_PINS_PATH", tmp_path / "graph_pins.json")
    pins_mod.set_pin("meta_default", "ep-1", pinned=True)
    assert "ep-1" in pins_mod.load_pins("meta_default")
    pins_mod.set_pin("meta_default", "ep-1", pinned=False)
    assert "ep-1" not in pins_mod.load_pins("meta_default")


@pytest.mark.asyncio
async def test_bulk_delete_skips_pinned(tmp_path, monkeypatch):
    from agenticx.memory.graph import pins as pins_mod
    from agenticx.memory.graph import store as store_mod

    monkeypatch.setattr(pins_mod, "DEFAULT_PINS_PATH", tmp_path / "graph_pins.json")
    pins_mod.set_pin("meta_default", "pinned-1", pinned=True)

    deleted_ids: list[str] = []

    async def _fake_remove_bulk(episode_uuids: list[str]) -> dict:
        deleted_ids.extend(episode_uuids)
        return {"deleted": list(episode_uuids), "failed": []}

    class _Store(store_mod.MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            return None

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.episode_delete.remove_episodes_isolated",
        _fake_remove_bulk,
    )
    result = await store.delete_episodes_bulk("meta_default", ["pinned-1", "free-1"])
    assert result["skipped_pinned"] == ["pinned-1"]
    assert result["deleted"] == ["free-1"]
    assert deleted_ids == ["free-1"]


@pytest.mark.asyncio
async def test_bulk_delete_collects_per_episode_failures(monkeypatch):
    from agenticx.memory.graph import store as store_mod

    async def _fake_remove_bulk(episode_uuids: list[str]) -> dict:
        deleted = [x for x in episode_uuids if x != "bad-1"]
        failed = (
            [{"episode_uuid": "bad-1", "error": "simulated corrupt episode"}]
            if "bad-1" in episode_uuids
            else []
        )
        return {"deleted": deleted, "failed": failed}

    class _Store(store_mod.MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            return None

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.episode_delete.remove_episodes_isolated",
        _fake_remove_bulk,
    )
    result = await store.delete_episodes_bulk("meta_default", ["good-1", "bad-1"])
    assert result["deleted"] == ["good-1"]
    assert result["failed"] == [
        {"episode_uuid": "bad-1", "error": "simulated corrupt episode"}
    ]


@pytest.mark.asyncio
async def test_bulk_delete_falls_back_to_rebuild_on_sigsegv(monkeypatch):
    from agenticx.memory.graph import store as store_mod

    async def _fake_remove_bulk(episode_uuids: list[str]) -> dict:
        # everything segfaults in isolated delete -> should trigger rebuild
        return {
            "deleted": [],
            "failed": [
                {"episode_uuid": u, "error": "删除 episode 时图谱引擎异常（SIGSEGV）…"}
                for u in episode_uuids
            ],
        }

    rebuild_calls: list[list[str]] = []

    async def _fake_rebuild(uuids, *, cfg=None) -> dict:
        rebuild_calls.append(list(uuids))
        return {"deleted": list(uuids), "remaining": 0, "backup": "/tmp/x.bak"}

    class _Store(store_mod.MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            return None

        def reset_runtime(self) -> None:
            return None

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.episode_delete.remove_episodes_isolated",
        _fake_remove_bulk,
    )
    monkeypatch.setattr(
        "agenticx.memory.graph.graph_rebuild.rebuild_graph_excluding_episodes",
        _fake_rebuild,
    )
    result = await store.delete_episodes_bulk("meta_default", ["c1", "c2"])
    assert rebuild_calls == [["c1", "c2"]]
    assert sorted(result["deleted"]) == ["c1", "c2"]
    assert result["failed"] == []


def test_select_episodes_for_prune_never_deletes_pinned():
    episodes = [{"id": "old", "referenceTime": "2020-01-01T00:00:00+00:00"}]
    to_delete, kept = select_episodes_for_prune(
        episodes,
        max_episodes=0,
        max_age_days=1,
        pinned={"old"},
    )
    assert to_delete == []
    assert kept == 1
