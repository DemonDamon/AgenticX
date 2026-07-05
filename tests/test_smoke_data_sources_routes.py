"""Smoke tests for the /api/data-sources/* HTTP routes.

Author: Damon Li
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    app = create_studio_app()
    return TestClient(app)


def test_get_data_sources_status_lists_catalog(client):
    resp = client.get("/api/data-sources/status")
    assert resp.status_code == 200
    body = resp.json()
    names = {item["name"] for item in body.get("data_sources", [])}
    assert "akshare" in names
    assert "ifind" in names


def test_put_data_sources_config_toggles_and_reloads_registry(client, tmp_path, monkeypatch):
    from agenticx.cli import config_manager as cm

    cfg = tmp_path / "config.yaml"
    cfg.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cm.ConfigManager, "GLOBAL_CONFIG_PATH", cfg)

    resp = client.put(
        "/api/data-sources/config",
        json={"name": "akshare", "patch": {"enabled": False}},
    )
    assert resp.status_code == 200
    assert resp.json().get("ok") is True

    status = client.get("/api/data-sources/status").json()
    akshare = next(item for item in status["data_sources"] if item["name"] == "akshare")
    assert akshare["enabled"] is False
    assert akshare["status"] == "disabled"


def test_unknown_data_source_test_returns_404(client):
    resp = client.post("/api/data-sources/test", json={"name": "does-not-exist"})
    assert resp.status_code == 404
