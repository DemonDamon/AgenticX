#!/usr/bin/env python3
"""Desktop worker protocol dual, gateway LLM, and interactive environments.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.managed.gateway_llm import GatewayLLMFactory
from agenticx.managed.protocol import SessionRecord, Usage, WorkItemRecord
from agenticx.managed.worker.client import MAWorkerClient, WorkAssignment
from agenticx.managed.worker.runner import MAWorker, WorkItemRunner
from agenticx.runtime.enterprise_worker import (
    MA_ENV_MISSING,
    _TrackedRunner,
    worker_protocol,
)
from agenticx.runtime.session_boundary import sessions_root

_TOKEN = "agx-pat-x" # gitleaks:allow
_ENTERPRISE = "https://portal.example"
_LOCAL = "http://127.0.0.1:9"


def _isolate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)
    monkeypatch.setattr("agenticx.runtime.enterprise_worker.agx_home", lambda: tmp_path)


def _login(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, worker: bool | None) -> None:
    _isolate(monkeypatch, tmp_path)
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", _TOKEN)
    ConfigManager.set_value("enterprise.base_url", _ENTERPRISE)
    if worker is not None:
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


def _worker(script: _Script) -> tuple[Any, httpx.AsyncClient]:
    from agenticx.runtime.enterprise_worker import EnterpriseWorker

    client = httpx.AsyncClient(transport=httpx.MockTransport(script.handler), trust_env=False)
    worker = EnterpriseWorker(local_base_url=_LOCAL, desktop_token="desktop-test", http=client) # gitleaks:allow
    return worker, client


def test_worker_protocol_values(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _isolate(monkeypatch, tmp_path)
    assert worker_protocol() == "legacy"
    ConfigManager.set_value("enterprise.worker.protocol", "MA")
    assert worker_protocol() == "ma"
    ConfigManager.set_value("enterprise.worker.protocol", "Dual")
    assert worker_protocol() == "dual"
    ConfigManager.set_value("enterprise.worker.protocol", "grpc")
    assert worker_protocol() == "legacy"


async def test_dual_runs_ma_then_legacy(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _login(monkeypatch, tmp_path, worker=True)
    ConfigManager.set_value("enterprise.worker.protocol", "dual")
    ConfigManager.set_value("enterprise.worker.ma_environment_ids", ["W1"])
    calls: list[int] = []

    async def fake_false(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self
        calls.append(max_wait_seconds)
        return False

    monkeypatch.setattr(MAWorker, "run_once", fake_false)
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
    assert calls == [0]
    paths = script.paths()
    assert any(path.endswith("/api/desktop/worker/heartbeat") for path in paths)
    assert any(path.endswith("/api/desktop/worker/tasks/claim") for path in paths)

    calls.clear()

    async def fake_true(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self
        calls.append(max_wait_seconds)
        return True

    monkeypatch.setattr(MAWorker, "run_once", fake_true)
    quiet = _Script()
    second, second_client = _worker(quiet)
    async with second_client:
        assert await second.run_once() is True
    assert calls == [0]
    assert quiet.requests == []


def test_ma_worker_uses_gateway_and_session_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    _login(monkeypatch, tmp_path, worker=True)
    script = _Script()
    worker, _client = _worker(script)
    built = worker._ma_worker_for(_TOKEN, _ENTERPRISE, ["W1"])
    factory = built._runner._llm_factory
    assert isinstance(factory, GatewayLLMFactory)
    assert factory.base_url == "https://portal.example/v1"
    assert _TOKEN not in repr(factory)
    assert built._runner._workdir_root == sessions_root()
    ConfigManager.set_value("enterprise.worker.gateway_url", "http://127.0.0.1:8088/v1/")
    rebuilt = worker._ma_worker_for(_TOKEN, _ENTERPRISE, ["W1"])
    assert rebuilt is not built
    assert rebuilt._runner._llm_factory.base_url == "http://127.0.0.1:8088/v1"


async def test_auto_environment_discovery_cached(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _login(monkeypatch, tmp_path, worker=True)
    ConfigManager.set_value("enterprise.worker.protocol", "ma")
    ConfigManager.set_value("enterprise.worker.ma_environment_mode", "auto")
    calls = {"n": 0}

    async def listed(self: Any) -> list[dict[str, str]]:
        del self
        calls["n"] += 1
        return [{"id": "W1", "name": "研发"}]

    async def no_work(self: Any, *, max_wait_seconds: int = 0) -> bool:
        del self, max_wait_seconds
        return False

    monkeypatch.setattr(MAWorkerClient, "list_eligible_environments", listed)
    monkeypatch.setattr(MAWorker, "run_once", no_work)
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker._run_once_ma(_TOKEN, _ENTERPRISE) is False
        assert await worker._run_once_ma(_TOKEN, _ENTERPRISE) is False
    assert calls["n"] == 1
    assert worker.status()["ma_environments"] == [{"id": "W1", "name": "研发"}]

    async def empty(self: Any) -> list[dict[str, str]]:
        del self
        return []

    monkeypatch.setattr(MAWorkerClient, "list_eligible_environments", empty)
    fresh, fresh_client = _worker(_Script())
    async with fresh_client:
        assert await fresh._run_once_ma(_TOKEN, _ENTERPRISE) is False
    assert fresh.status()["last_error"] != MA_ENV_MISSING


async def test_interactive_environment_runs_without_worker_switch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _login(monkeypatch, tmp_path, worker=None)
    seen: dict[str, Any] = {}

    async def fake(self: Any, *, max_wait_seconds: int = 0) -> bool:
        seen["ids"] = list(self._environment_ids)
        seen["wait"] = max_wait_seconds
        return True

    monkeypatch.setattr(MAWorker, "run_once", fake)
    script = _Script()
    worker, client = _worker(script)
    worker.add_interactive_environment("W9")
    async with client:
        assert await worker.run_once() is True
    assert seen["ids"] == ["W9"]
    assert seen["wait"] == 0
    assert script.requests == []
    with pytest.raises(ValueError, match="invalid environment id"):
        worker.add_interactive_environment("bad/id")
    deadline = worker._interactive_envs["W9"]
    monkeypatch.setattr(time, "monotonic", lambda: deadline + 1)
    assert worker._interactive_active() is False


async def test_tracked_runner_reports_work(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _isolate(monkeypatch, tmp_path)
    from agenticx.runtime.enterprise_worker import EnterpriseWorker

    worker = EnterpriseWorker(local_base_url=_LOCAL, desktop_token="desktop-test") # gitleaks:allow
    session_id = "01JSESSION0000000000000000"
    work_id = "01JWORK000000000000000000"

    async def slow(self: WorkItemRunner, assignment: WorkAssignment) -> None:
        del self, assignment
        await asyncio.sleep(0.2)

    monkeypatch.setattr(WorkItemRunner, "run", slow)
    async with httpx.AsyncClient(trust_env=False) as http:
        runner = _TrackedRunner(
            owner=worker,
            client=MAWorkerClient("http://ma.test", _TOKEN, http=http),
            device_id="dev-aaaaaaaa",
            llm_factory=GatewayLLMFactory(base_url="http://gw/v1", token=_TOKEN),
            workdir_root=sessions_root(),
        )
        assignment = WorkAssignment(
            work=WorkItemRecord(
                id=work_id,
                session_id=session_id,
                environment_id="W1",
                status="claimed",
            ),
            session=SessionRecord(
                id=session_id,
                tenant_id="T",
                agent_id="01JAGENT00000000000000000",
                agent_version=3,
                source="api",
                status="idle",
                usage=Usage(),
                created_at="2026-10-26T08:00:00.000Z",
                updated_at="2026-10-26T08:00:00.000Z",
            ),
            agent_id="01JAGENT00000000000000000",
            agent_version=3,
            manifest={},
            inbox_after_seq=0,
        )
        task = asyncio.create_task(runner.run(assignment))
        await asyncio.sleep(0.05)
        active = worker.status()["ma_work"]
        assert any(item["work_id"] == work_id for item in active)
        assert active[0]["workdir"].startswith("~/.agenticx/sessions/")
        await task
    assert worker.status()["ma_work"] == []


def test_status_keeps_legacy_keys(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _isolate(monkeypatch, tmp_path)
    from agenticx.runtime.enterprise_worker import EnterpriseWorker

    worker = EnterpriseWorker(local_base_url=_LOCAL, desktop_token="desktop-test") # gitleaks:allow
    body = worker.status()
    for key in (
        "enabled",
        "running",
        "device_id",
        "agents",
        "last_heartbeat_at",
        "current_task_id",
        "last_error",
        "protocol",
        "ma_enabled",
        "ma_environment_mode",
        "ma_environments",
        "ma_work",
        "interactive_environments",
    ):
        assert key in body
