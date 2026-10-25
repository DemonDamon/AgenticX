#!/usr/bin/env python3
"""Studio routes for the managed desktop worker switch.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_worker import EnterpriseWorker
from agenticx.studio.enterprise_worker_routes import register_enterprise_worker_routes


def _isolate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)


def _client(tmp_path: Path, worker: object | None = None) -> TestClient:
    app = FastAPI()
    if worker is not None:
        app.state.enterprise_worker = worker
    register_enterprise_worker_routes(app, lambda _token: None)
    return TestClient(app)


def test_put_ma_enabled_writes_dual_and_auto(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    client = _client(tmp_path, EnterpriseWorker(local_base_url="http://127.0.0.1:9", desktop_token="t"))
    enabled = client.put("/api/enterprise-worker", json={"ma_enabled": True})
    assert enabled.status_code == 200
    assert ConfigManager.get_value("enterprise.worker.protocol") == "dual"
    assert ConfigManager.get_value("enterprise.worker.ma_environment_mode") == "auto"
    disabled = client.put("/api/enterprise-worker", json={"ma_enabled": False})
    assert disabled.status_code == 200
    assert ConfigManager.get_value("enterprise.worker.protocol") == "legacy"


def test_put_requires_a_field(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    response = _client(tmp_path).put("/api/enterprise-worker", json={})
    assert response.status_code == 400
    assert response.json()["detail"] == "enabled or ma_enabled is required"


def test_put_enabled_unchanged_behaviour(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    response = _client(tmp_path).put("/api/enterprise-worker", json={"enabled": True})
    assert response.status_code == 200
    assert ConfigManager.get_value("enterprise.worker.enabled") is True


def test_interactive_requires_login(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    response = _client(tmp_path).post(
        "/api/enterprise-worker/interactive-environments",
        json={"environment_id": "W9"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "enterprise_login_required"


def test_interactive_registers_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", "agx-pat-test")
    ConfigManager.set_value("enterprise.base_url", "http://enterprise.test")
    worker = EnterpriseWorker(local_base_url="http://127.0.0.1:9", desktop_token="t")
    response = _client(tmp_path, worker).post(
        "/api/enterprise-worker/interactive-environments",
        json={"environment_id": "W9"},
    )
    assert response.status_code == 200
    assert response.json()["expires_in"] == 1800
    assert worker.status()["interactive_environments"] == ["W9"]


def test_status_includes_ma_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    worker = EnterpriseWorker(local_base_url="http://127.0.0.1:9", desktop_token="t")
    body = _client(tmp_path, worker).get("/api/enterprise-worker/status").json()
    for key in (
        "protocol",
        "ma_enabled",
        "ma_environment_mode",
        "ma_environments",
        "ma_work",
        "interactive_environments",
    ):
        assert key in body
