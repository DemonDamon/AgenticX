#!/usr/bin/env python3
"""Desktop enterprise agent catalog passthrough and detail route.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_agent_sync import (
    EnterpriseCatalogError,
    fetch_enterprise_agent_detail,
    fetch_published_agents,
)
from agenticx.studio.enterprise_worker_routes import register_enterprise_worker_routes

AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ"
TOKEN = "agx-pat-test" # gitleaks:allow


def _isolate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, logged_in: bool) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)
    ConfigManager.set_value("enterprise.enabled", logged_in)
    if logged_in:
        ConfigManager.set_value("enterprise.token", TOKEN)
        ConfigManager.set_value("enterprise.base_url", "http://enterprise.test")


def _response(status: int, payload: object) -> httpx.Response:
    request = httpx.Request("GET", "http://enterprise.test/api/desktop/agents")
    return httpx.Response(status, json=payload, request=request)


def _client() -> TestClient:
    app = FastAPI()
    register_enterprise_worker_routes(app, check_token=lambda _token: None)
    return TestClient(app)


def test_fetch_published_agents_passes_new_fields(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=True)
    payload = {
        "agents": [
            {
                "id": AGENT,
                "displayName": "报告助手",
                "effectiveVersion": 2,
                "defaultEnvironment": {"id": "01JQMZ8K3N4P5Q6R7S8T9VWXY0", "name": "研发桌面", "type": "desktop_worker"},
            },
            "skip-me",
        ]
    }

    def fake_get(url: str, headers: dict | None = None, timeout: float | None = None, trust_env: bool | None = None) -> httpx.Response:
        assert url == "http://enterprise.test/api/desktop/agents"
        assert headers is not None
        assert headers["Authorization"] == f"Bearer {TOKEN}"
        assert trust_env is False
        assert timeout == 8.0
        return _response(200, payload)

    monkeypatch.setattr(httpx, "get", fake_get)
    agents = fetch_published_agents()
    assert agents == [payload["agents"][0]]
    assert agents[0]["effectiveVersion"] == 2
    assert agents[0]["defaultEnvironment"]["name"] == "研发桌面"


def test_detail_not_logged_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=False)

    def fake_get(*_args: object, **_kwargs: object) -> httpx.Response:
        raise AssertionError("portal must not be called when logged out")

    monkeypatch.setattr(httpx, "get", fake_get)
    response = _client().get(f"/api/enterprise-agents/{AGENT}")
    assert response.status_code == 409
    assert response.json()["detail"] == "enterprise_login_required"
    assert TOKEN not in response.text


def test_detail_404_and_502(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=True)
    seen: list[int] = []

    def fake_get(url: str, headers: dict | None = None, timeout: float | None = None, trust_env: bool | None = None) -> httpx.Response:
        assert TOKEN not in url
        assert headers is not None
        assert TOKEN in headers["Authorization"]
        assert trust_env is False
        assert timeout == 8.0
        status = 404 if not seen else 500
        seen.append(status)
        return _response(status, {"code": "40400"} if status == 404 else {"error": "boom"})

    monkeypatch.setattr(httpx, "get", fake_get)
    client = _client()
    missing = client.get(f"/api/enterprise-agents/{AGENT}")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "enterprise agent not found"
    unavailable = client.get(f"/api/enterprise-agents/{AGENT}")
    assert unavailable.status_code == 502
    assert unavailable.json()["detail"] == "enterprise unavailable"
    assert TOKEN not in missing.text
    assert TOKEN not in unavailable.text


def test_detail_rejects_bad_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=True)
    response = _client().get("/api/enterprise-agents/abc")
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid agent id"


def test_detail_ok(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=True)
    portal = {
        "agent": {"id": AGENT, "displayName": "报告助手", "effectiveVersion": 2},
        "version": {"version": 2, "note": "加工具", "summary": {"model": "openai/gpt-4o"}},
    }

    def fake_get(url: str, **_kwargs: object) -> httpx.Response:
        assert url == f"http://enterprise.test/api/desktop/agents/{AGENT}"
        return _response(200, portal)

    monkeypatch.setattr(httpx, "get", fake_get)
    response = _client().get(f"/api/enterprise-agents/{AGENT}")
    assert response.status_code == 200
    assert response.json() == portal


def test_detail_network_error_hides_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _isolate(monkeypatch, tmp_path, logged_in=True)

    def fake_get(*_args: object, **_kwargs: object) -> httpx.Response:
        raise RuntimeError(f"down {TOKEN}")

    monkeypatch.setattr(httpx, "get", fake_get)
    with caplog.at_level("WARNING"):
        response = _client().get(f"/api/enterprise-agents/{AGENT}")
    assert response.status_code == 502
    assert TOKEN not in response.text
    assert TOKEN not in caplog.text
    with pytest.raises(EnterpriseCatalogError, match="network"):
        fetch_enterprise_agent_detail(AGENT)
