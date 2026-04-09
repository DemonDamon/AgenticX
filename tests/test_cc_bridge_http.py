#!/usr/bin/env python3
"""HTTP layer tests for CC bridge (auth + routing).

Author: Damon Li
"""

from __future__ import annotations

import os
import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from agenticx.cc_bridge.http_app import app


def _which_claude() -> str | None:
    return shutil.which("claude")


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CC_BRIDGE_TOKEN", "test-secret-token")
    return TestClient(app)


def test_health_unauthenticated(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_list_sessions_requires_bearer(client: TestClient) -> None:
    r = client.get("/v1/sessions")
    assert r.status_code == 401


def test_list_sessions_rejects_bad_token(client: TestClient) -> None:
    r = client.get("/v1/sessions", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 403


def test_list_sessions_ok(client: TestClient) -> None:
    r = client.get("/v1/sessions", headers={"Authorization": "Bearer test-secret-token"})
    assert r.status_code == 200
    body = r.json()
    assert "sessions" in body
    assert isinstance(body["sessions"], list)


def test_invalid_session_id_rejected(client: TestClient) -> None:
    r = client.delete(
        "/v1/sessions/not-a-uuid",
        headers={"Authorization": "Bearer test-secret-token"},
    )
    assert r.status_code == 400


@pytest.mark.skipif(not _which_claude(), reason="claude CLI not installed")
@pytest.mark.skipif(os.environ.get("AGX_CC_BRIDGE_SMOKE") != "1", reason="set AGX_CC_BRIDGE_SMOKE=1 to run")
def test_smoke_spawn_real_claude(client: TestClient) -> None:
    """Optional integration: requires working Claude Code CLI and credentials."""
    r = client.post(
        "/v1/sessions",
        headers={"Authorization": "Bearer test-secret-token"},
        json={"cwd": os.getcwd(), "auto_allow_permissions": True},
    )
    assert r.status_code == 200
    sid = r.json()["session_id"]
    uuid.UUID(sid)
    msg = client.post(
        f"/v1/sessions/{sid}/message",
        headers={"Authorization": "Bearer test-secret-token"},
        json={"text": "Reply with exactly: OK", "wait_seconds": 180.0},
    )
    assert msg.status_code == 200
    client.delete(
        f"/v1/sessions/{sid}",
        headers={"Authorization": "Bearer test-secret-token"},
    )
