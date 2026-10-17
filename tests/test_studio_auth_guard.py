#!/usr/bin/env python3
"""Auth and Host checks on the local studio API.

Author: Damon Li
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


@pytest.fixture(scope="module")
def client(monkeypatch_module: None) -> TestClient:
    del monkeypatch_module
    app = create_studio_app()
    with TestClient(app) as http:
        yield http


@pytest.fixture(scope="module")
def monkeypatch_module() -> None:
    mp = pytest.MonkeyPatch()
    mp.setenv("AGX_DESKTOP_TOKEN", "t")
    mp.setenv("AGX_SERVE_BIND", "127.0.0.1")
    yield
    mp.undo()


def test_unauthenticated_sensitive_routes_are_rejected(client: TestClient) -> None:
    loopback = {"Host": "127.0.0.1"}
    assert client.get("/api/kb/config", headers=loopback).status_code == 401
    assert client.get("/api/typesafe/settings", headers=loopback).status_code == 401


def test_token_allows_sensitive_routes(client: TestClient) -> None:
    headers = {"Host": "127.0.0.1", "x-agx-desktop-token": "t"}
    assert client.get("/api/kb/config", headers=headers).status_code != 401
    assert client.get("/api/typesafe/settings", headers=headers).status_code != 401


def test_health_is_open_and_foreign_host_is_rejected(client: TestClient) -> None:
    assert client.get("/api/health", headers={"Host": "127.0.0.1"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 421
