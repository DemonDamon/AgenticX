#!/usr/bin/env python3
"""API contract tests for memory graph governance routes.

Author: Damon Li
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def _enabled_cfg():
    class _Retention:
        enabled = False
        max_episodes = 200
        max_age_days = 90
        on_ingest = True

    class _Cfg:
        enabled = True
        default_scope = "meta"
        backend = "kuzu"
        db_path = __import__("pathlib").Path("/tmp/x.kuzu")
        ingest = type("I", (), {"auto": True, "max_queue": 8, "semaphore_limit": 1, "max_chars_per_episode": 1000})()
        retention = _Retention()
        llm = type("L", (), {"provider": "", "model": ""})()
        embedder = type("E", (), {"provider": "", "model": ""})()
        telemetry = False
        status_path = __import__("pathlib").Path("/tmp/status.json")
        search_in_chat = True
        search_in_chat_graph_limit = 2

    return _Cfg()


@pytest.fixture()
def enabled_client(monkeypatch):
    from agenticx.memory.graph import config as cfg_mod
    from agenticx.memory.graph import store as store_mod

    class _Store:
        async def delete_episodes_bulk(self, group_id, episode_uuids):
            return {"deleted": list(episode_uuids), "skipped_pinned": [], "count": len(episode_uuids)}

        async def preview_episode_impact(self, group_id, episode_uuid):
            return {
                "episodeId": episode_uuid,
                "groupId": group_id,
                "nodeCount": 2,
                "edgeCount": 1,
                "note": "test note",
            }

        async def prune_episodes(self, group_id, **kwargs):
            if kwargs.get("dry_run"):
                return {"would_delete": ["e1"], "count": 1, "kept": 2}
            return {"deleted": ["e1"], "count": 1, "kept": 2}

    monkeypatch.setenv("AGX_MEMORY_GRAPH_ENABLED", "1")
    monkeypatch.setattr(cfg_mod, "load_memory_graph_config", _enabled_cfg)
    monkeypatch.setattr(store_mod.MemoryGraphStore, "singleton", classmethod(lambda cls: _Store()))
    app = create_studio_app()
    return TestClient(app)


def test_bulk_delete_ok(enabled_client):
    resp = enabled_client.post(
        "/api/memory/graph/episodes/bulk-delete",
        json={"group_id": "meta_default", "episode_uuids": ["a", "b"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("count") == 2


def test_episode_impact_ok(enabled_client):
    resp = enabled_client.get(
        "/api/memory/graph/episode/ep-1/impact",
        params={"group_id": "meta_default"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("nodeCount") == 2
    assert body.get("note")


def test_retention_run_dry_run(enabled_client):
    resp = enabled_client.post(
        "/api/memory/graph/retention/run",
        json={"group_id": "meta_default", "dry_run": True},
    )
    assert resp.status_code == 200
    assert resp.json().get("would_delete") == ["e1"]


def test_governance_routes_group_access_denied(enabled_client):
    resp = enabled_client.post(
        "/api/memory/graph/episodes/bulk-delete",
        json={"group_id": "avatar_other", "episode_uuids": ["x"], "session_id": "s1"},
    )
    assert resp.status_code == 403


def test_episode_pin_ok(enabled_client, tmp_path, monkeypatch):
    from agenticx.memory.graph import pins as pins_mod

    monkeypatch.setattr(pins_mod, "DEFAULT_PINS_PATH", tmp_path / "graph_pins.json")
    resp = enabled_client.post(
        "/api/memory/graph/episode/ep-pin/pin",
        json={"group_id": "meta_default", "pinned": True},
    )
    assert resp.status_code == 200
    assert pins_mod.is_pinned("meta_default", "ep-pin") is True
