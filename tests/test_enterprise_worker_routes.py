#!/usr/bin/env python3
"""HTTP tests for the local enterprise worker switch.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_worker import worker_enabled
from agenticx.studio.enterprise_worker_routes import register_enterprise_worker_routes


def _isolate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", "agx-pat-test")
    ConfigManager.set_value("enterprise.base_url", "http://enterprise.test")


class _Worker:
    def status(self) -> dict:
        enabled = worker_enabled()
        return {
            "enabled": enabled,
            "running": enabled,
            "device_id": "near-0123456789abcdef0123456789abcdef",
            "agents": [{"id": "agent-1", "displayName": "桌面工程师"}],
            "last_heartbeat_at": None,
            "current_task_id": None,
            "last_error": None,
        }


def _client(worker: object | None = None, check=None) -> TestClient:
    app = FastAPI()
    if worker is not None:
        app.state.enterprise_worker = worker
    register_enterprise_worker_routes(app, check or (lambda _token: None))
    return TestClient(app)


def test_status_without_worker_is_stopped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)
    response = _client().get("/api/enterprise-worker/status")
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "running": False}


def test_put_persists_switch_and_returns_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)
    client = _client(_Worker())
    enabled = client.put("/api/enterprise-worker", json={"enabled": True})
    assert enabled.status_code == 200
    body = enabled.json()
    assert body["enabled"] is True
    assert body["running"] is True
    assert body["agents"][0]["displayName"] == "桌面工程师"
    assert ConfigManager.get_value("enterprise.worker.enabled") is True
    assert "agx-pat-test" not in enabled.text

    disabled = client.put("/api/enterprise-worker", json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert disabled.json()["running"] is False
    assert ConfigManager.get_value("enterprise.worker.enabled") is False


def test_put_without_worker_still_writes_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)
    response = _client().put("/api/enterprise-worker", json={"enabled": True})
    assert response.status_code == 200
    assert response.json() == {"enabled": True, "running": False}
    assert ConfigManager.get_value("enterprise.worker.enabled") is True


def test_routes_require_desktop_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)

    def _check(token: str | None) -> None:
        if token != "desktop-ok":
            raise HTTPException(status_code=401, detail="invalid desktop token")

    client = _client(check=_check)
    missing = client.get("/api/enterprise-worker/status")
    assert missing.status_code == 401
    allowed = client.get(
        "/api/enterprise-worker/status",
        headers={"x-agx-desktop-token": "desktop-ok"},
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"enabled": False, "running": False}
