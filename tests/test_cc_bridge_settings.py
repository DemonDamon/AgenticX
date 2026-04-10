#!/usr/bin/env python3
"""Tests for CC bridge Studio client URL policy.

Author: Damon Li
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agenticx.cc_bridge.settings import (
    cc_bridge_mode,
    ensure_cc_bridge_token_persisted,
    validate_bridge_url_for_studio,
)
from agenticx.cli.config_manager import ConfigManager
from agenticx.studio.server import create_studio_app


@pytest.mark.parametrize(
    ("url", "expect_err"),
    [
        ("http://127.0.0.1:9742", False),
        ("http://localhost:9/x", False),
        ("http://[::1]:9742", False),
        ("http://example.com:9742", True),
    ],
)
def test_validate_loopback(url: str, expect_err: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_CC_BRIDGE_ALLOW_NONLOCAL", raising=False)
    err = validate_bridge_url_for_studio(url)
    if expect_err:
        assert err is not None
    else:
        assert err is None


def test_validate_nonlocal_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_CC_BRIDGE_ALLOW_NONLOCAL", "1")
    assert validate_bridge_url_for_studio("http://10.0.0.5:9742") is None


@pytest.fixture()
def isolated_config(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    return tmp_path


def test_ensure_cc_bridge_token_persisted_generates_and_stable(
    monkeypatch: pytest.MonkeyPatch,
    isolated_config,
) -> None:
    monkeypatch.delenv("AGX_CC_BRIDGE_TOKEN", raising=False)
    t1 = ensure_cc_bridge_token_persisted()
    assert len(t1) >= 16
    t2 = ensure_cc_bridge_token_persisted()
    assert t1 == t2


def test_ensure_cc_bridge_token_respects_env(
    monkeypatch: pytest.MonkeyPatch,
    isolated_config,
) -> None:
    monkeypatch.setenv("AGX_CC_BRIDGE_TOKEN", "env-only-token")
    assert ensure_cc_bridge_token_persisted() == "env-only-token"


@pytest.fixture()
def studio_client_no_desktop_token(monkeypatch: pytest.MonkeyPatch, tmp_path) -> TestClient:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    return TestClient(create_studio_app())


def test_api_cc_bridge_config_get_generates_token(
    studio_client_no_desktop_token: TestClient,
) -> None:
    r = studio_client_no_desktop_token.get("/api/cc-bridge/config")
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert data.get("url")
    tok = data.get("token", "")
    assert len(tok) >= 16
    assert data.get("idle_stop_seconds") == 600
    assert data.get("mode") in ("headless", "visible_tui")


def test_api_cc_bridge_config_put_and_regenerate(
    studio_client_no_desktop_token: TestClient,
) -> None:
    g = studio_client_no_desktop_token.get("/api/cc-bridge/config")
    tok0 = g.json()["token"]
    r = studio_client_no_desktop_token.put(
        "/api/cc-bridge/config",
        json={"url": "http://127.0.0.1:9742", "token": tok0, "idle_stop_seconds": 321},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    assert r.json().get("idle_stop_seconds") == 321

    reg = studio_client_no_desktop_token.post("/api/cc-bridge/token/regenerate")
    assert reg.status_code == 200
    body = reg.json()
    assert body.get("ok") is True
    new_tok = body.get("token", "")
    assert len(new_tok) >= 16
    assert new_tok != tok0


def test_api_cc_bridge_config_put_mode(
    studio_client_no_desktop_token: TestClient,
) -> None:
    g = studio_client_no_desktop_token.get("/api/cc-bridge/config")
    tok = g.json()["token"]
    r = studio_client_no_desktop_token.put(
        "/api/cc-bridge/config",
        json={"url": "http://127.0.0.1:9742", "token": tok, "mode": "visible_tui"},
    )
    assert r.status_code == 200
    assert r.json().get("mode") == "visible_tui"
    r2 = studio_client_no_desktop_token.put(
        "/api/cc-bridge/config",
        json={"url": "http://127.0.0.1:9742", "token": tok, "mode": "headless"},
    )
    assert r2.status_code == 200
    assert r2.json().get("mode") == "headless"


def test_api_cc_bridge_config_put_invalid_mode(
    studio_client_no_desktop_token: TestClient,
) -> None:
    g = studio_client_no_desktop_token.get("/api/cc-bridge/config")
    tok = g.json()["token"]
    r = studio_client_no_desktop_token.put(
        "/api/cc-bridge/config",
        json={"url": "http://127.0.0.1:9742", "token": tok, "mode": "nope"},
    )
    assert r.status_code == 400


def test_cc_bridge_mode_env_overrides_config(
    monkeypatch: pytest.MonkeyPatch,
    isolated_config,
) -> None:
    ConfigManager.set_value("cc_bridge.mode", "headless", scope="global")
    monkeypatch.setenv("AGX_CC_BRIDGE_MODE", "visible_tui")
    assert cc_bridge_mode() == "visible_tui"
