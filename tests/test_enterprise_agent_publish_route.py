#!/usr/bin/env python3
"""HTTP tests for POST /api/avatars/{id}/enterprise-publish.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_agent_publish import EnterprisePublishError
from agenticx.studio.enterprise_worker_routes import register_enterprise_worker_routes


def _isolate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)


def _client() -> TestClient:
    app = FastAPI()
    register_enterprise_worker_routes(app, check_token=lambda _token: None)
    return TestClient(app)


def _create_avatar(**kwargs: object) -> str:
    avatar = AvatarRegistry().create_avatar("周报助手", **kwargs)  # type: ignore[arg-type]
    return avatar.id


def _login() -> None:
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", "agx-pat-test")
    ConfigManager.set_value("enterprise.base_url", "http://enterprise.test")


def test_dry_run_returns_preview(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    avatar_id = _create_avatar(default_provider="deepseek", default_model="deepseek-chat")
    _login()
    response = _client().post(
        f"/api/avatars/{avatar_id}/enterprise-publish",
        json={"dry_run": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["dry_run"] is True
    assert body["report"]["model"] == "deepseek/deepseek-chat"


def test_not_logged_in_409(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    avatar_id = _create_avatar(default_provider="deepseek", default_model="deepseek-chat")
    response = _client().post(
        f"/api/avatars/{avatar_id}/enterprise-publish",
        json={"dry_run": True},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "enterprise_login_required"


def test_unknown_avatar_404(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate(monkeypatch, tmp_path)
    _login()
    response = _client().post(
        "/api/avatars/missing-avatar/enterprise-publish",
        json={"dry_run": True},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "avatar not found"


def test_manifest_invalid_returns_ok_false(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)
    avatar_id = _create_avatar()
    _login()

    def _forbidden(*_args: object, **_kwargs: object) -> dict:
        raise AssertionError("publish_avatar_draft must not be called")

    monkeypatch.setattr(
        "agenticx.studio.enterprise_worker_routes.publish_avatar_draft",
        _forbidden,
    )
    response = _client().post(
        f"/api/avatars/{avatar_id}/enterprise-publish",
        json={"dry_run": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"] == "manifest_invalid"


def test_publish_success_and_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolate(monkeypatch, tmp_path)
    avatar_id = _create_avatar(default_provider="deepseek", default_model="deepseek-chat")
    _login()
    result = {
        "agent_id": "agent-1",
        "version": 1,
        "created": True,
        "lifecycle": "draft",
        "routing_mode": "follow_latest",
        "effective_version": 1,
    }

    def _ok(*_args: object, **_kwargs: object) -> dict:
        return result

    monkeypatch.setattr(
        "agenticx.studio.enterprise_worker_routes.publish_avatar_draft",
        _ok,
    )
    client = _client()
    success = client.post(
        f"/api/avatars/{avatar_id}/enterprise-publish",
        json={"dry_run": False, "note": "第一次提交"},
    )
    assert success.status_code == 200
    assert success.json()["result"] == result

    def _fail(*_args: object, **_kwargs: object) -> dict:
        raise EnterprisePublishError(409, "x")

    monkeypatch.setattr(
        "agenticx.studio.enterprise_worker_routes.publish_avatar_draft",
        _fail,
    )
    failure = client.post(
        f"/api/avatars/{avatar_id}/enterprise-publish",
        json={"dry_run": False},
    )
    assert failure.status_code == 200
    body = failure.json()
    assert body["ok"] is False
    assert body["message"] == "HTTP 409 · x"
