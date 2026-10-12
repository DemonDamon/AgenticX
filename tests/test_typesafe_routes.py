#!/usr/bin/env python3
"""Tests for /api/typesafe settings and probe routes.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.typesafe_client import TypesafeHttpError
from agenticx.studio.typesafe_routes import register_typesafe_routes


def _setup_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config._typesafe_key_file",
        lambda: tmp_path / "missing-typesafe-key",
    )


def _client() -> TestClient:
    app = FastAPI()
    register_typesafe_routes(app)
    return TestClient(app)


def test_get_settings_returns_key_for_form(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("typesafe.api_key", "secret-token-xyz", scope="global")
    ConfigManager.set_value("typesafe.enabled", True, scope="global")
    resp = _client().get("/api/typesafe/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_key"] is True
    assert body["api_key"] == "secret-token-xyz"


def test_put_omits_key_keeps_existing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("typesafe.api_key", "keep-me", scope="global")
    resp = _client().put("/api/typesafe/settings", json={"enabled": True})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True
    assert resp.json()["has_key"] is True
    assert resp.json()["api_key"] == "keep-me"
    assert ConfigManager.get_value("typesafe.api_key") == "keep-me"


def test_put_empty_key_clears(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("typesafe.api_key", "wipe-me", scope="global")
    resp = _client().put("/api/typesafe/settings", json={"api_key": ""})
    assert resp.status_code == 200
    assert resp.json()["has_key"] is False
    assert resp.json()["api_key"] == ""
    assert ConfigManager.get_value("typesafe.api_key") == ""


def test_post_test_without_key_returns_400(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    resp = _client().post("/api/typesafe/test")
    assert resp.status_code == 400
    body = resp.json()
    assert body["ok"] is False
    assert "error" in body


def test_post_test_401_from_upstream(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("typesafe.api_key", "bad-key", scope="global")

    async def _boom(**_kwargs):
        raise TypesafeHttpError(401, "unauthorized", retryable=False)

    monkeypatch.setattr("agenticx.studio.typesafe_routes.system_one", _boom)
    resp = _client().post("/api/typesafe/test")
    assert resp.status_code == 401
    assert resp.json()["ok"] is False
