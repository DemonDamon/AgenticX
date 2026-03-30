#!/usr/bin/env python3
"""Tests for QR connect session API and device bindings HTTP.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.config import DeviceAuthEntry, DevicesConfig, GatewayServerConfig
from agenticx.gateway.models import GatewayMessage


class DummyAdapter:
    platform = "feishu"

    def __init__(self) -> None:
        self.replies: list = []

    async def send_reply(self, reply) -> bool:
        self.replies.append(reply)
        return True


def _cfg_with_code() -> GatewayServerConfig:
    return GatewayServerConfig(
        devices=DevicesConfig(
            auth_tokens=[
                DeviceAuthEntry(device_id="d1", token="tok1", binding_code="111222"),
            ]
        )
    )


def test_connect_session_requires_auth() -> None:
    app = create_gateway_app(_cfg_with_code())
    c = TestClient(app)
    r = c.post("/api/connect/session", json={"device_id": "d1", "token": "bad"})
    assert r.status_code == 401


def test_connect_session_missing_binding_code() -> None:
    cfg = GatewayServerConfig(
        devices=DevicesConfig(
            auth_tokens=[DeviceAuthEntry(device_id="d1", token="tok1", binding_code="")],
        )
    )
    app = create_gateway_app(cfg)
    c = TestClient(app)
    r = c.post("/api/connect/session", json={"device_id": "d1", "token": "tok1"})
    assert r.status_code == 400


def test_connect_session_create_and_poll() -> None:
    app = create_gateway_app(_cfg_with_code())
    c = TestClient(app)
    r = c.post("/api/connect/session", json={"device_id": "d1", "token": "tok1"})
    assert r.status_code == 200
    data = r.json()
    assert data["binding_code"] == "111222"
    assert data["status"] == "pending"
    sid = data["session_id"]
    assert "/connect/" in data["qr_url"]

    p = c.get(f"/api/connect/session/{sid}")
    assert p.status_code == 200
    assert p.json()["status"] == "pending"


def test_connect_page_marks_scanned() -> None:
    app = create_gateway_app(_cfg_with_code())
    c = TestClient(app)
    sid = c.post("/api/connect/session", json={"device_id": "d1", "token": "tok1"}).json()["session_id"]
    html = c.get(f"/connect/{sid}")
    assert html.status_code == 200
    assert "111222" in html.text
    p = c.get(f"/api/connect/session/{sid}")
    assert p.json()["status"] == "scanned"


def test_bind_marks_session_bound() -> None:
    app = create_gateway_app(_cfg_with_code())
    c = TestClient(app)
    sid = c.post("/api/connect/session", json={"device_id": "d1", "token": "tok1"}).json()["session_id"]

    router = app.state.router
    adapter = DummyAdapter()
    msg = GatewayMessage(
        message_id="1",
        source="feishu",
        sender_id="ou_x",
        sender_name="Tester",
        content="绑定 111222",
    )
    asyncio.run(router.route(msg, adapter))

    p = c.get(f"/api/connect/session/{sid}")
    body = p.json()
    assert body["status"] == "bound"
    assert body["platform"] == "feishu"
    assert body["sender_name"] == "Tester"


def test_list_and_delete_bindings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "gw_bindings.json"
    monkeypatch.setenv("AGX_GATEWAY_BINDINGS_PATH", str(path))
    app = create_gateway_app(_cfg_with_code())
    c = TestClient(app)
    um = app.state.user_map
    um.set_binding("feishu", "ou_1", "d1")

    r = c.get("/api/device/d1/bindings", params={"token": "tok1"})
    assert r.status_code == 200
    assert len(r.json()["bindings"]) == 1

    d = c.delete(
        "/api/device/d1/bindings",
        params={"token": "tok1", "platform": "feishu", "sender_id": "ou_1"},
    )
    assert d.status_code == 200
    r2 = c.get("/api/device/d1/bindings", params={"token": "tok1"})
    assert r2.json()["bindings"] == []


def test_user_device_map_get_bindings_and_remove(tmp_path: Path) -> None:
    from agenticx.gateway.user_device_map import UserDeviceMap

    p = tmp_path / "x.json"
    m = UserDeviceMap(p)
    m.set_binding("feishu", "ou_1", "dev-a")
    rows = m.get_bindings_for_device("dev-a")
    assert len(rows) == 1
    assert rows[0]["platform"] == "feishu"
    assert rows[0]["sender_id"] == "ou_1"
    assert m.remove_binding("feishu", "ou_1") is True
    assert m.get_bindings_for_device("dev-a") == []
