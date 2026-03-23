#!/usr/bin/env python3
"""Tests for Desktop favorite -> long-term memory persistence (POST /api/memory/save)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from agenticx.studio import server as server_module
from agenticx.studio.server import create_studio_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    app = create_studio_app()
    return TestClient(app)


def test_save_memory_calls_append_long_term(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[tuple[object, str]] = []

    def fake_append(ws, note: str) -> None:
        captured.append((ws, note))

    monkeypatch.setattr(server_module, "append_long_term_memory", fake_append)
    mock_instance = MagicMock()
    monkeypatch.setattr(server_module, "WorkspaceMemoryStore", MagicMock(return_value=mock_instance))

    session_id = client.get("/api/session").json()["session_id"]
    r = client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": "hello favorite", "message_id": "m1"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data.get("memory_persisted") is True
    assert len(captured) == 1
    assert captured[0][1].startswith("[用户收藏] ")
    assert "hello favorite" in captured[0][1]
    mock_instance.index_workspace_sync.assert_called_once()


def test_save_memory_triggers_reindex(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server_module, "append_long_term_memory", lambda *_a, **_k: None)
    mock_instance = MagicMock()
    monkeypatch.setattr(server_module, "WorkspaceMemoryStore", MagicMock(return_value=mock_instance))

    session_id = client.get("/api/session").json()["session_id"]
    client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": "x", "message_id": "m2"},
    )
    mock_instance.index_workspace_sync.assert_called_once()
    wd = mock_instance.index_workspace_sync.call_args[0][0]
    assert wd is not None


def test_save_memory_truncates_long_content(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[str] = []

    def fake_append(_ws, note: str) -> None:
        captured.append(note)

    monkeypatch.setattr(server_module, "append_long_term_memory", fake_append)
    monkeypatch.setattr(server_module, "WorkspaceMemoryStore", MagicMock(return_value=MagicMock()))

    session_id = client.get("/api/session").json()["session_id"]
    long_body = "Z" * 1000
    client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": long_body, "message_id": "m3"},
    )
    assert len(captured) == 1
    body = captured[0]
    assert body.startswith("[用户收藏] ")
    payload = body[len("[用户收藏] ") :].strip()
    assert len(payload) <= 500


def test_save_memory_still_writes_scratchpad(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server_module, "append_long_term_memory", lambda *_a, **_k: None)
    monkeypatch.setattr(server_module, "WorkspaceMemoryStore", MagicMock(return_value=MagicMock()))

    session_id = client.get("/api/session").json()["session_id"]
    r1 = client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": "first", "message_id": "a"},
    )
    r2 = client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": "second", "message_id": "b"},
    )
    assert r1.json()["saved_count"] == 1
    assert r2.json()["saved_count"] == 2
    manager = client.app.state.session_manager
    managed = manager.get(session_id, touch=False)
    assert managed is not None
    saved = managed.studio_session.scratchpad.get("saved_messages", [])
    assert len(saved) == 2
    assert saved[0]["content"] == "first"
    assert saved[1]["content"] == "second"


def test_save_memory_best_effort_on_failure(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_ws, _note: str) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr(server_module, "append_long_term_memory", boom)
    mock_instance = MagicMock()
    monkeypatch.setattr(server_module, "WorkspaceMemoryStore", MagicMock(return_value=mock_instance))

    session_id = client.get("/api/session").json()["session_id"]
    r = client.post(
        "/api/memory/save",
        json={"session_id": session_id, "content": "still saved to scratchpad", "message_id": "m4"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data.get("memory_persisted") is False
    mock_instance.index_workspace_sync.assert_not_called()
