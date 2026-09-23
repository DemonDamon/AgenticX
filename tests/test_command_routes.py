#!/usr/bin/env python3
"""HTTP tests for composer command routes.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.studio.command_routes import register_command_routes


def _client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    register_command_routes(
        app,
        lambda _token: None,
        commands_root=tmp_path / "commands",
        sessions_root=tmp_path / "sessions",
    )
    return TestClient(app)


def test_create_conflict_visible_and_pin(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post(
        "/api/commands",
        json={"scope": "global", "name": "summarize-pr", "description": "", "instructions": "look"},
    )
    assert created.status_code == 201
    again = client.post(
        "/api/commands",
        json={"scope": "global", "name": "summarize-pr", "description": "", "instructions": "look"},
    )
    assert again.status_code == 409
    assert again.json()["detail"] == "command name already exists"
    visible = client.get("/api/commands/visible", params={"context": "meta"})
    assert visible.status_code == 200
    names = [item["name"] for item in visible.json()["items"]]
    assert "perf" in names
    pinned = client.post(
        "/api/sessions/sess-1/commands/pin",
        json={"scope": "global", "subject_id": "", "name": "summarize-pr"},
    )
    assert pinned.status_code == 201
    after = client.get("/api/commands/visible", params={"context": "meta", "session_id": "sess-1"})
    row = next(item for item in after.json()["items"] if item["name"] == "summarize-pr")
    assert row["scope"] == "session"


def test_global_list_includes_builtin_and_can_disable_it(tmp_path: Path) -> None:
    client = _client(tmp_path)
    listed = client.get("/api/commands", params={"scope": "global"})
    assert listed.status_code == 200
    perf = next(item for item in listed.json()["builtins"] if item["name"] == "perf")
    assert perf["enabled"] is True
    updated = client.put("/api/commands/builtins/perf", json={"enabled": False})
    assert updated.status_code == 200
    visible = client.get("/api/commands/visible", params={"context": "meta"})
    assert "perf" not in [item["name"] for item in visible.json()["items"]]
