#!/usr/bin/env python3
"""Device token and command secret checks on the IM gateway.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from agenticx.gateway.app import _secret_equals, create_gateway_app
from agenticx.gateway.config import DeviceAuthEntry, DevicesConfig, GatewayServerConfig

DEVICE_ID = "d1"
DEVICE_TOKEN = "tok1"
COMMAND_PHRASE = "test-phrase"


def _client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, secret: str = "") -> TestClient:
    monkeypatch.setenv("AGX_MOBILE_TOKEN_FILE", str(tmp_path / "mobile_tokens.json"))
    cfg = GatewayServerConfig(
        devices=DevicesConfig(auth_tokens=[DeviceAuthEntry(device_id=DEVICE_ID, token=DEVICE_TOKEN)]),
        command_api_secret=secret,
    )
    return TestClient(create_gateway_app(cfg))


def test_secret_equals() -> None:
    assert _secret_equals("abc", "abc")
    assert not _secret_equals("abc", "abd")
    assert not _secret_equals(None, "abc")
    assert not _secret_equals("", "")
    assert not _secret_equals("abc", "密钥")


def test_command_rejects_wrong_device_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/command", json={"text": "hi", "device_id": DEVICE_ID, "token": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid device token"


def test_command_rejects_non_ascii_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/command", json={"text": "hi", "device_id": DEVICE_ID, "token": "令牌"})
    assert r.status_code == 401


def test_command_rejects_unknown_device(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/command", json={"text": "hi", "device_id": "other", "token": DEVICE_TOKEN})
    assert r.status_code == 401


def test_command_accepts_device_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.post("/api/command", json={"text": "hi", "device_id": DEVICE_ID, "token": DEVICE_TOKEN})
    assert r.status_code == 503
    assert r.json()["detail"] == "device offline"


def test_command_secret_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch, secret=COMMAND_PHRASE)
    body = {"text": "hi", "device_id": DEVICE_ID}
    assert c.post("/api/command", json=body, headers={"x-agx-command-secret": "wrong"}).status_code == 401
    ok_header = c.post("/api/command", json=body, headers={"x-agx-command-secret": COMMAND_PHRASE})
    assert ok_header.status_code == 503
    ok_body = c.post("/api/command", json={**body, "token": COMMAND_PHRASE})
    assert ok_body.status_code == 503


def test_device_ws_rejects_wrong_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(tmp_path, monkeypatch)
    with pytest.raises(WebSocketDisconnect) as exc:
        with c.websocket_connect(f"/ws/device/{DEVICE_ID}?token=wrong") as ws:
            ws.receive_text()
    assert exc.value.code == 4401
