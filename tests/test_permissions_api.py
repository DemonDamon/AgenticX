#!/usr/bin/env python3
"""GET/PUT /api/permissions round-trips allowed_tools and command_permissions.

Author: Damon Li
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def test_permissions_round_trip_allowed_tools_and_command_permissions() -> None:
    app = create_studio_app()
    client = TestClient(app)

    first = client.get("/api/permissions")
    assert first.status_code == 200
    body = first.json()
    assert body.get("ok") is True
    assert "allowed_tools" in body
    assert "command_permissions" in body
    assert body.get("shell_read_isolation") in {"full", "none"}
    assert body.get("path_deny_enforcement") in {"full", "partial", "none"}

    put = client.put(
        "/api/permissions",
        json={
            "allowed_tools": ["bash_exec", "file_write"],
            "command_permissions": "read-only",
            "unknown_future_key": {"should": "be ignored"},
        },
    )
    assert put.status_code == 200
    saved = put.json()
    assert saved.get("ok") is True
    assert saved.get("allowed_tools") == ["bash_exec", "file_write"]
    assert saved.get("command_permissions") == "read-only"
    assert saved.get("shell_read_isolation") in {"full", "none"}
    assert saved.get("path_deny_enforcement") in {"full", "partial", "none"}
    assert "unknown_future_key" not in saved

    again = client.get("/api/permissions")
    assert again.status_code == 200
    assert again.json().get("allowed_tools") == ["bash_exec", "file_write"]
    assert again.json().get("command_permissions") == "read-only"
