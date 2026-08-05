#!/usr/bin/env python3
"""Tests for health/readiness probes and graceful draining (Plan D).

Covers:
- AC-3: /api/health always 200; /api/ready reflects storage/bus connectivity;
- AC-4: draining rejects new chat turns with a server_draining SSE error while
  the readiness/liveness probes keep answering;
- run tracking: wait_runs_drained semantics.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app
from agenticx.studio.session_manager import SessionManager


def test_health_and_ready_local_mode() -> None:
    app = create_studio_app()
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    # Local storage + in-process bus are always ready.
    resp = client.get("/api/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_ready_503_when_storage_down(monkeypatch: pytest.MonkeyPatch) -> None:
    app = create_studio_app()

    async def _down() -> bool:
        return False

    from agenticx.studio.storage import factory as storage_factory

    backend = storage_factory.get_storage_backend()
    monkeypatch.setattr(backend, "ping", _down)

    client = TestClient(app)
    resp = client.get("/api/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "not_ready"
    assert body["detail"]["storage"] is False


def test_draining_rejects_new_chat() -> None:
    app = create_studio_app()
    client = TestClient(app)

    create = client.post("/api/sessions", json={})
    assert create.status_code == 200
    sid = create.json()["session_id"]

    app.state.draining = True
    try:
        with client.stream(
            "POST",
            "/api/chat",
            json={"session_id": sid, "user_input": "hello"},
        ) as resp:
            assert resp.status_code == 200  # SSE stream, error carried as event
            lines = [line for line in resp.iter_lines() if line]
        payloads = [json.loads(line[5:].strip()) for line in lines if line.startswith("data:")]
        types = [p.get("type") for p in payloads]
        assert "error" in types
        error_payload = next(p for p in payloads if p.get("type") == "error")
        assert error_payload["data"]["error"] == "server_draining"
        assert "done" in types
    finally:
        app.state.draining = False
        client.delete(f"/api/sessions/{sid}")


def test_not_draining_allows_chat_path_past_gate() -> None:
    """Without draining, /api/chat proceeds (fails later for missing model, not 503)."""
    app = create_studio_app()
    client = TestClient(app)
    create = client.post("/api/sessions", json={})
    sid = create.json()["session_id"]
    try:
        with client.stream(
            "POST",
            "/api/chat",
            json={"session_id": sid, "user_input": "hello"},
        ) as resp:
            lines = [line for line in resp.iter_lines() if line]
        payloads = [json.loads(line[5:].strip()) for line in lines if line.startswith("data:")]
        # Whatever the outcome (model may be unconfigured), it must NOT be the
        # draining rejection.
        assert all(
            (p.get("data") or {}).get("error") != "server_draining" for p in payloads
        )
    finally:
        client.delete(f"/api/sessions/{sid}")


# ── run tracking ──


async def test_wait_runs_drained() -> None:
    manager = SessionManager()
    assert await manager.wait_runs_drained(timeout_seconds=0.5) is True
    manager.run_started()
    manager.run_started()
    assert manager.active_runs == 2

    async def _finish_later() -> None:
        await asyncio.sleep(0.2)
        manager.run_finished()
        manager.run_finished()

    task = asyncio.create_task(_finish_later())
    assert await manager.wait_runs_drained(timeout_seconds=2.0) is True
    await task

    manager.run_started()
    assert await manager.wait_runs_drained(timeout_seconds=0.2) is False
    manager.run_finished()
    assert manager.active_runs == 0
