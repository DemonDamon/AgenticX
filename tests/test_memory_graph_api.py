#!/usr/bin/env python3
"""API contract tests for memory graph routes.

Author: Damon Li
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AGX_MEMORY_GRAPH_ENABLED", "0")
    app = create_studio_app()
    return TestClient(app)


def test_memory_graph_overview_disabled(client):
    resp = client.get("/api/memory/graph/overview", params={"session_id": "s1"})
    assert resp.status_code == 503
    body = resp.json()
    assert body.get("detail", {}).get("error") == "memory_graph_disabled"


def test_memory_graph_status_ok(client):
    resp = client.get("/api/memory/graph/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert "enabled" in body


def test_group_access_denied(client, monkeypatch):
    monkeypatch.setenv("AGX_MEMORY_GRAPH_ENABLED", "1")
    # Reload config path by patching load
    from agenticx.memory.graph import config as cfg_mod

    class _Cfg:
        enabled = True
        default_scope = "session"
        backend = "kuzu"
        db_path = __import__("pathlib").Path("/tmp/x.kuzu")
        ingest = type("I", (), {"auto": True, "max_queue": 8, "semaphore_limit": 1, "max_chars_per_episode": 1000})()
        llm = type("L", (), {"provider": "", "model": ""})()
        embedder = type("E", (), {"provider": "", "model": ""})()
        telemetry = False
        status_path = __import__("pathlib").Path("/tmp/status.json")

    monkeypatch.setattr(cfg_mod, "load_memory_graph_config", lambda: _Cfg())
    app = create_studio_app()
    c = TestClient(app)
    resp = c.get(
        "/api/memory/graph/overview",
        params={"group_id": "session:other", "session_id": "mine"},
    )
    assert resp.status_code == 403


def test_memory_graph_overview_meta_group_without_session(monkeypatch):
    """Settings → 记忆 (meta scope) may call overview with group_id only."""
    from agenticx.memory.graph import config as cfg_mod
    from agenticx.memory.graph import store as store_mod

    class _Cfg:
        enabled = True
        default_scope = "meta"
        backend = "kuzu"
        db_path = __import__("pathlib").Path("/tmp/x.kuzu")
        ingest = type("I", (), {"auto": True, "max_queue": 8, "semaphore_limit": 1, "max_chars_per_episode": 1000})()
        llm = type("L", (), {"provider": "", "model": ""})()
        embedder = type("E", (), {"provider": "", "model": ""})()
        telemetry = False
        status_path = __import__("pathlib").Path("/tmp/status.json")

    class _Store:
        async def get_overview(self, group_id: str, **kwargs):
            return {
                "nodes": [],
                "edges": [],
                "meta": {
                    "groupId": group_id,
                    "generatedAt": "2026-01-01T00:00:00+00:00",
                    "truncated": False,
                    "nodeCount": 0,
                    "edgeCount": 0,
                },
            }

    monkeypatch.setattr(cfg_mod, "load_memory_graph_config", lambda: _Cfg())
    monkeypatch.setattr(store_mod.MemoryGraphStore, "singleton", classmethod(lambda cls: _Store()))
    app = create_studio_app()
    c = TestClient(app)
    resp = c.get("/api/memory/graph/overview", params={"group_id": "meta_default"})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("meta", {}).get("groupId") == "meta_default"


def test_memory_graph_overview_session_group_requires_session_id(monkeypatch):
    from agenticx.memory.graph import config as cfg_mod
    from agenticx.memory.graph import store as store_mod

    class _Cfg:
        enabled = True
        default_scope = "session"
        backend = "kuzu"
        db_path = __import__("pathlib").Path("/tmp/x.kuzu")
        ingest = type("I", (), {"auto": True, "max_queue": 8, "semaphore_limit": 1, "max_chars_per_episode": 1000})()
        llm = type("L", (), {"provider": "", "model": ""})()
        embedder = type("E", (), {"provider": "", "model": ""})()
        telemetry = False
        status_path = __import__("pathlib").Path("/tmp/status.json")

    class _Store:
        async def get_overview(self, group_id: str, **kwargs):
            return {
                "nodes": [],
                "edges": [],
                "meta": {"groupId": group_id, "generatedAt": "2026-01-01T00:00:00+00:00", "truncated": False},
            }

    monkeypatch.setattr(cfg_mod, "load_memory_graph_config", lambda: _Cfg())
    monkeypatch.setattr(store_mod.MemoryGraphStore, "singleton", classmethod(lambda cls: _Store()))
    app = create_studio_app()
    c = TestClient(app)

    denied = c.get("/api/memory/graph/overview", params={"group_id": "session_s1"})
    assert denied.status_code == 403
    assert denied.json().get("detail", {}).get("error") == "group_access_denied"

    ok = c.get(
        "/api/memory/graph/overview",
        params={"group_id": "session_s1", "session_id": "s1"},
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_finalize_chat_runtime_schedules_ingest_without_saw_final(monkeypatch):
    scheduled: list[tuple] = []

    def _fake_schedule(session_id: str, **kwargs):
        scheduled.append((session_id, kwargs))

    monkeypatch.setattr(
        "agenticx.memory.graph.writer.schedule_turn_ingest_from_session",
        _fake_schedule,
    )
    monkeypatch.setattr("agenticx.studio.server._flush_taskspace_hint", lambda *a, **k: None)
    monkeypatch.setattr(
        "agenticx.studio.server._resolve_chat_end_execution_state",
        lambda *a, **k: "idle",
    )

    class _Manager:
        def clear_interrupt(self, _sid: str) -> None:
            pass

        def set_execution_state(self, _sid: str, _state: str) -> None:
            pass

        def persist(self, _sid: str) -> None:
            pass

        async def persist_async(self, _sid: str) -> None:
            pass

        def get(self, _sid: str, touch: bool = False):
            return type("Managed", (), {"avatar_id": None})()

    class _Session:
        chat_history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "world"},
        ]

    from agenticx.studio.server import _finalize_chat_runtime

    await _finalize_chat_runtime(
        _Manager(),
        "session-1",
        _Session(),
        saw_final=False,
        had_runtime_failure=False,
    )
    assert scheduled and scheduled[0][0] == "session-1"
