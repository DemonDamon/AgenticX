#!/usr/bin/env python3
"""HTTP tests for visible_tui PTY stream / write / resize endpoints.

Author: Damon Li
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from agenticx.cc_bridge import http_app


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CC_BRIDGE_TOKEN", "test-secret-token")
    return TestClient(http_app.app)


def test_stream_404_unknown_session(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    monkeypatch.setattr(http_app._manager, "get", lambda _x: None)
    r = client.get(f"/v1/sessions/{sid}/stream", headers={"Authorization": "Bearer test-secret-token"})
    assert r.status_code == 404


def test_stream_400_headless_session(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    mock_sess = MagicMock()
    mock_sess.session_kind = "headless"
    monkeypatch.setattr(http_app._manager, "get", lambda x: mock_sess if x == sid else None)
    r = client.get(f"/v1/sessions/{sid}/stream", headers={"Authorization": "Bearer test-secret-token"})
    assert r.status_code == 400


def test_stream_ok_visible_mock(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    mock_sess = MagicMock()
    mock_sess.session_kind = "visible_tui"
    monkeypatch.setattr(http_app._manager, "get", lambda x: mock_sess if x == sid else None)

    def fake_iter(_session_id: str):
        yield b"hello"
        yield b"\x1b[0m"

    monkeypatch.setattr(http_app._manager, "iter_pty_stream_chunks", fake_iter)
    r = client.get(f"/v1/sessions/{sid}/stream", headers={"Authorization": "Bearer test-secret-token"})
    assert r.status_code == 200
    assert b"hello" in r.content


def test_write_400_headless(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    mock_sess = MagicMock()
    mock_sess.session_kind = "headless"
    monkeypatch.setattr(http_app._manager, "get", lambda x: mock_sess if x == sid else None)
    r = client.post(
        f"/v1/sessions/{sid}/write",
        headers={"Authorization": "Bearer test-secret-token"},
        json={"data": "x"},
    )
    assert r.status_code == 400


def test_write_ok_visible_calls_manager(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    mock_sess = MagicMock()
    mock_sess.session_kind = "visible_tui"
    monkeypatch.setattr(http_app._manager, "get", lambda x: mock_sess if x == sid else None)
    called: list[tuple[str, str]] = []

    def capture(sid_arg: str, data: str) -> None:
        called.append((sid_arg, data))

    monkeypatch.setattr(http_app._manager, "write_pty_raw", capture)
    r = client.post(
        f"/v1/sessions/{sid}/write",
        headers={"Authorization": "Bearer test-secret-token"},
        json={"data": "abc\n"},
    )
    assert r.status_code == 200
    assert called == [(sid, "abc\n")]


def test_resize_ok_visible_calls_manager(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sid = str(uuid.uuid4())
    mock_sess = MagicMock()
    mock_sess.session_kind = "visible_tui"
    monkeypatch.setattr(http_app._manager, "get", lambda x: mock_sess if x == sid else None)
    called: list[tuple[str, int, int]] = []

    def capture(sid_arg: str, rows: int, cols: int) -> None:
        called.append((sid_arg, rows, cols))

    monkeypatch.setattr(http_app._manager, "resize_pty_session", capture)
    r = client.post(
        f"/v1/sessions/{sid}/resize",
        headers={"Authorization": "Bearer test-secret-token"},
        json={"cols": 100, "rows": 30},
    )
    assert r.status_code == 200
    assert called == [(sid, 30, 100)]
