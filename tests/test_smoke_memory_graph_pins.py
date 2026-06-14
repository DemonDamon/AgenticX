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

    class _FakeGraphiti:
        async def remove_episode(self, uuid: str) -> None:
            deleted_ids.append(uuid)

    class _Store(store_mod.MemoryGraphStore):
        async def _ensure_ready_impl(self) -> None:
            self._graphiti = _FakeGraphiti()

    store = _Store()
    monkeypatch.setattr(
        "agenticx.memory.graph.executor.run_on_graphiti_loop",
        lambda coro: coro,
    )
    result = await store.delete_episodes_bulk("meta_default", ["pinned-1", "free-1"])
    assert result["skipped_pinned"] == ["pinned-1"]
    assert result["deleted"] == ["free-1"]
    assert deleted_ids == ["free-1"]


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
