#!/usr/bin/env python3
"""Enterprise worker protocol switch. Legacy behaviour stays the default.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_worker import (
    AUTH_ERROR,
    MA_ENV_MISSING,
    EnterpriseWorker,
    WorkerAuthError,
    worker_protocol,
)

_TOKEN = "agx-pat-test" # gitleaks:allow
_ENTERPRISE = "http://enterprise.test"
_LOCAL = "http://127.0.0.1:9"


def _isolate_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)


def _enable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, worker: bool) -> None:
    _isolate_config(monkeypatch, tmp_path)
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", _TOKEN)
    ConfigManager.set_value("enterprise.base_url", _ENTERPRISE)
    ConfigManager.set_value("enterprise.worker.enabled", worker)


class _Script:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/heartbeat"):
            return httpx.Response(200, json={"agents": []})
        if path.endswith("/claim"):
            return httpx.Response(200, json={"task": None})
        return httpx.Response(404, json={"detail": "missing"})

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]


def _worker(script: _Script) -> tuple[EnterpriseWorker, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(script.handler), trust_env=False)
    worker = EnterpriseWorker(
        local_base_url=_LOCAL,
        desktop_token="desktop-test", # gitleaks:allow
        http=client,
    )
    return worker, client


async def test_default_protocol_is_legacy(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.agx_home",
        lambda: tmp_path,
    )
    calls: list[int] = []

    async def fake(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self
        calls.append(max_wait_seconds)
        return True

    monkeypatch.setattr("agenticx.runtime.enterprise_worker.MAWorker.run_once", fake)
    assert worker_protocol() == "legacy"
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
    paths = script.paths()
    assert any(path.endswith("/api/desktop/worker/heartbeat") for path in paths)
    assert any(path.endswith("/api/desktop/worker/tasks/claim") for path in paths)
    assert calls == []


async def test_ma_protocol_routes_to_ma_worker(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    monkeypatch.setattr("agenticx.runtime.enterprise_worker.agx_home", lambda: tmp_path)
    ConfigManager.set_value("enterprise.worker.protocol", "ma")
    ConfigManager.set_value("enterprise.worker.ma_environment_ids", ["worker"])
    ConfigManager.set_value("enterprise.worker.ma_base_url", "http://127.0.0.1:9")
    calls: list[int] = []

    async def fake(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self
        calls.append(max_wait_seconds)
        return True

    monkeypatch.setattr("agenticx.runtime.enterprise_worker.MAWorker.run_once", fake)
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    assert calls == [0]
    assert script.requests == []


async def test_ma_protocol_without_environments(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    ConfigManager.set_value("enterprise.worker.protocol", "ma")
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
    assert worker.status()["last_error"] == MA_ENV_MISSING
    assert script.requests == []


async def test_ma_protocol_auth_error_pauses(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    monkeypatch.setattr("agenticx.runtime.enterprise_worker.agx_home", lambda: tmp_path)
    ConfigManager.set_value("enterprise.worker.protocol", "ma")
    ConfigManager.set_value("enterprise.worker.ma_environment_ids", ["worker"])
    calls: list[int] = []

    async def fake(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self, max_wait_seconds
        calls.append(1)
        raise WorkerAuthError(401, "unauthorized", "x")

    monkeypatch.setattr("agenticx.runtime.enterprise_worker.MAWorker.run_once", fake)
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
        assert worker.status()["last_error"] == AUTH_ERROR
        assert await worker.run_once() is False
    assert calls == [1]


async def test_unknown_protocol_value_is_legacy(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    ConfigManager.set_value("enterprise.worker.protocol", "grpc")
    assert worker_protocol() == "legacy"
