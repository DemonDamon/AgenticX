#!/usr/bin/env python3
"""Tests for authenticated replay branch creation API.

Author: Damon Li
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from agenticx.runtime.replay_ledger.branch_service import (
    BranchConflictError,
    BranchInternalError,
    BranchNotFoundError,
    BranchService,
)
from agenticx.studio.server import create_studio_app


def _app(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "desktop-secret")
    app = create_studio_app()
    app.state.session_manager._sessions_root = str(tmp_path / "sessions")
    return app


def test_branch_api_requires_token_and_validates_schema(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)
    unauthenticated = TestClient(app)
    assert (
        unauthenticated.post(
            "/api/runs/run-a/branches",
            json={"source_event_id": "event-a", "instruction": "continue"},
        ).status_code
        == 401
    )
    authenticated = TestClient(app, headers={"x-agx-desktop-token": "desktop-secret"})
    assert (
        authenticated.post(
            "/api/runs/run-a/branches",
            json={"source_event_id": "", "instruction": ""},
        ).status_code
        == 422
    )


def test_branch_api_returns_safe_success_shape(tmp_path, monkeypatch) -> None:
    app = _app(tmp_path, monkeypatch)

    def _create(self, **kwargs):
        return {
            "ok": True,
            "session_id": "new-session",
            "source_run_id": kwargs["source_run_id"],
            "resolved_checkpoint_seq": 100,
            "requested_event": {
                "event_id": "e101",
                "seq": 101,
                "type": "tool_call",
                "title": "bash",
            },
            "resolved_event": {
                "event_id": "e100",
                "seq": 100,
                "type": "tool_result",
                "title": "file",
            },
            "lineage": {"parent_run_id": kwargs["source_run_id"]},
            "warnings": [],
            "instruction": kwargs["instruction"],
            "provider": kwargs["provider"],
            "model": kwargs["model"],
        }

    monkeypatch.setattr(BranchService, "create_branch", _create)
    response = TestClient(app, headers={"x-agx-desktop-token": "desktop-secret"}).post(
        "/api/runs/run-a/branches",
        json={
            "source_event_id": "e101",
            "instruction": "continue",
            "provider": "p",
            "model": "m",
        },
    )
    assert response.status_code == 200
    assert response.json()["requested_event"]["seq"] == 101
    assert response.json()["resolved_event"]["seq"] == 100
    assert response.json()["source_run_id"] == "run-a"
    assert response.json()["resolved_checkpoint_seq"] == 100


def test_branch_api_maps_not_found_and_conflict_without_payload_leak(
    tmp_path,
    monkeypatch,
) -> None:
    app = _app(tmp_path, monkeypatch)
    client = TestClient(app, headers={"x-agx-desktop-token": "desktop-secret"})
    for error, status in (
        (BranchNotFoundError("event_not_found"), 404),
        (BranchConflictError("source_session_running"), 409),
        (BranchConflictError("run_incomplete"), 409),
        (BranchInternalError("workspace_restore_failed:read_tree"), 500),
    ):
        monkeypatch.setattr(
            BranchService,
            "create_branch",
            lambda self, **kwargs: (_ for _ in ()).throw(error),
        )
        response = client.post(
            "/api/runs/run-a/branches",
            json={"source_event_id": "event-a", "instruction": "SECRET_PAYLOAD"},
        )
        assert response.status_code == status
        assert response.json()["detail"]["code"] == error.code
        assert "SECRET_PAYLOAD" not in response.text
