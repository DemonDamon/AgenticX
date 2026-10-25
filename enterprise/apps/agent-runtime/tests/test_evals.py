#!/usr/bin/env python3
"""Eval runner: source=eval sessions, read-only memory mounts, internal routes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, select

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import HostConfig, Principal
from agenticx.managed.testing import ScriptStep, ScriptedLLM, tool_call

from fakes import FakeAdminConsole, agent_record, version_record
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.control_plane import AdminConsoleAgentRegistry, AdminConsoleClient
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.evals import wire_evals
from ma_agent_runtime.tables import ma_eval_candidates, metadata

AGENT = "01JBX000000000000000000001"
TENANT = "T"
TOKEN = "secret"
DATASET = "01JBX000000000000000000002"
RUBRIC = "01JBX000000000000000000003"
ITEM_A = "01JBX000000000000000000011"
ITEM_B = "01JBX000000000000000000012"
ITEM_C = "01JBX000000000000000000013"


class _Response:
    def __init__(self, content: str) -> None:
        self.content = content
        self.tool_calls: list[dict[str, Any]] = []


class SleepLLM:
    """Blocks a worker thread so the event loop can still poll the session."""

    def __init__(self, seconds: float) -> None:
        self._seconds = seconds

    def invoke(self, messages: Any, **kwargs: Any) -> _Response:
        del messages, kwargs
        time.sleep(self._seconds)
        return _Response("late")


class SequenceFactory:
    """One LLM per created session, in order. Optimizer calls get a JSON rewrite."""

    def __init__(self, llms: list[Any]) -> None:
        self._llms = list(llms)
        self.calls: list[str] = []

    def create(self, *, provider: str, model: str, context: Any) -> Any:
        del provider, model
        self.calls.append(context.agent_id)
        if context.agent_id == "ma.eval.optimizer":
            return ScriptedLLM([ScriptStep('{"system": "新提示", "rationale": "r"}')])
        llm = self._llms.pop(0) if self._llms else ScriptedLLM([ScriptStep("本月汇总如下")])
        return llm


class RecordingRegistry:
    def __init__(self, inner: AdminConsoleAgentRegistry) -> None:
        self.inner = inner
        self.calls: list[str] = []

    async def get_agent(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append("get_agent")
        return await self.inner.get_agent(*args, **kwargs)

    async def get_version(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append("get_version")
        return await self.inner.get_version(*args, **kwargs)

    async def get_environment(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append("get_environment")
        return await self.inner.get_environment(*args, **kwargs)


def _manifest(system: str = "you are a test agent", ask: bool = False) -> dict[str, Any]:
    tools: dict[str, Any] = {"type": "agx_builtin", "default_policy": "always_allow"}
    if ask:
        tools["configs"] = [{"name": "bash_exec", "policy": "always_ask"}]
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": system,
        "tools": [tools],
    }


def _bundle(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "runtime": "cloud",
        "effective": 1,
        "agent": agent_record(AGENT, TENANT, 1),
        "versions": {1: version_record(AGENT, 1, manifest)},
    }


def _rubric() -> dict[str, Any]:
    return {
        "id": RUBRIC,
        "name": "周报标准",
        "version": 1,
        "content": {
            "criteria": "",
            "mode": "binary",
            "pass_threshold": 0.7,
            "judge_model": None,
            "rule_checks": [{"type": "contains", "value": "汇总", "case_sensitive": False}],
        },
    }


def _items(*queries: str) -> list[dict[str, Any]]:
    ids = [ITEM_A, ITEM_B, ITEM_C]
    return [
        {
            "id": ids[index],
            "position": index + 1,
            "query": query,
            "expected_answer": None,
            "expected_tool_trace": None,
        }
        for index, query in enumerate(queries)
    ]


def _body(items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    payload = {
        "tenant_id": TENANT,
        "created_by_user_id": "admin",
        "agent_id": AGENT,
        "agent_version": 1,
        "environment_id": None,
        "dataset": {"id": DATASET, "name": "销售周报回归", "items": items},
        "rubric": _rubric(),
        "memory_store_ids": [],
        "concurrency": 1,
    }
    payload.update(extra)
    return payload


async def _boot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    factory: Any,
    *,
    manifest: dict[str, Any] | None = None,
    timeout: float = 30,
    runs: int = 2,
) -> tuple[Any, httpx.AsyncClient, Any]:
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    monkeypatch.setenv("AGX_LEARNING_ENABLED", "0")
    data = tmp_path / "ma"
    data.mkdir()
    fake = FakeAdminConsole(agents={AGENT: _bundle(manifest or _manifest())})
    client = AdminConsoleClient("http://admin.test", "it", transport=fake.transport)
    registry = RecordingRegistry(
        AdminConsoleAgentRegistry(client, cache_seconds=0, implicit_local_env=True)
    )
    config = HostConfig(data_dir=data, tenant_id=TENANT, tokens={}, agents={}, environments={}, dev=False)
    app = create_ma_app(config, llm_factory=factory, registry=registry)
    engine = create_engine(f"sqlite:///{tmp_path / 'eval.db'}")
    metadata.create_all(engine)
    wire_evals(
        app,
        sync_engine=engine,
        llm_factory=factory,
        settings=SimpleNamespace(
            eval_item_timeout_seconds=timeout,
            eval_max_concurrent_runs=runs,
            internal_token=TOKEN,
            eval_claim_interval_seconds=0.05,
        ),
    )
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    return app, http, engine


async def _shutdown(app: Any, http: httpx.AsyncClient, engine: Any) -> None:
    await http.aclose()
    await app.state.ma.shutdown()
    engine.dispose()


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


async def _wait_run(store: Any, run_id: str, statuses: set[str], timeout: float = 20) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = store.get_run(TENANT, run_id)
        if last is not None and last.get("status") in statuses:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(last)


@pytest.mark.asyncio
async def test_eval_run_end_to_end(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = SequenceFactory(
        [ScriptedLLM([ScriptStep("本月汇总如下")]), ScriptedLLM([ScriptStep("本月汇总如下")])]
    )
    app, http, engine = await _boot(tmp_path, monkeypatch, factory)
    try:
        created = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json=_body(_items("做周报", "再来一条"), concurrency=2),
        )
        assert created.status_code == 201, created.text
        run_id = created.json()["run"]["id"]
        store = app.state.ma.extras["eval_store"]
        done = await _wait_run(store, run_id, {"completed"})
        assert done["summary"]["passed"] == 2
        rows = store.list_results(run_id)
        assert [row["status"] for row in rows] == ["passed", "passed"]
        assert [row["score_milli"] for row in rows] == [1000, 1000]
        principal = Principal(tenant_id=TENANT, user_id="admin", scopes=frozenset({"ma:admin"}))
        for row in rows:
            record = await app.state.ma.service.get_session(principal, row["session_id"])
            assert record.source == "eval"
            assert record.status == "archived"
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_eval_sessions_mount_memory_read_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, http, engine = await _boot(
        tmp_path,
        monkeypatch,
        SequenceFactory([ScriptedLLM([ScriptStep("本月汇总如下")])]),
    )
    seen: list[Any] = []
    service = app.state.ma.service
    original = service.create_session

    async def spy(principal: Any, req: Any) -> Any:
        seen.append(req)
        return await original(principal, req)

    service.create_session = spy
    try:
        created = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json=_body(_items("记住"), memory_store_ids=["M1"]),
        )
        assert created.status_code == 201, created.text
        store = app.state.ma.extras["eval_store"]
        await _wait_run(store, created.json()["run"]["id"], {"completed", "failed"})
        assert seen, "create_session was not called"
        assert seen[0].source == "eval"
        assert seen[0].resources == [
            {"type": "memory_store", "memory_store_id": "M1", "access": "read_only"}
        ]
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_requires_action_and_timeout_are_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = SequenceFactory(
        [
            ScriptedLLM([ScriptStep("", [tool_call("bash_exec", {"command": "echo hi"}, "c1")])]),
            SleepLLM(2.5),
        ]
    )
    app, http, engine = await _boot(
        tmp_path,
        monkeypatch,
        factory,
        manifest=_manifest(ask=True),
        timeout=1,
        runs=1,
    )
    try:
        created = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json=_body(_items("需要确认", "会超时")),
        )
        assert created.status_code == 201, created.text
        run_id = created.json()["run"]["id"]
        store = app.state.ma.extras["eval_store"]
        done = await _wait_run(store, run_id, {"completed", "failed"}, timeout=15)
        assert done["status"] == "completed"
        assert done["summary"]["errored"] == 2
        assert done["summary"]["pass_rate"] is None
        rows = {row["item_id"]: row for row in store.list_results(run_id)}
        assert rows[ITEM_A]["status"] == "error"
        assert rows[ITEM_A]["error"] == "requires_action"
        assert rows[ITEM_B]["error"] == "timeout"
        principal = Principal(tenant_id=TENANT, user_id="admin", scopes=frozenset({"ma:admin"}))
        record = await app.state.ma.service.get_session(principal, rows[ITEM_A]["session_id"])
        assert record.status in {"idle", "archived"}
        assert record.stop_reason is not None
        assert record.stop_reason.type == "end_turn"
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_stale_run_requeued_and_resumes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, http, engine = await _boot(
        tmp_path,
        monkeypatch,
        SequenceFactory([ScriptedLLM([ScriptStep("本月汇总如下")])]),
    )
    store = app.state.ma.extras["eval_store"]
    try:
        seeded = store.create_run(
            {
                "tenant_id": TENANT,
                "kind": "eval",
                "status": "running",
                "agent_id": AGENT,
                "agent_version": 1,
                "environment_id": None,
                "dataset_id": DATASET,
                "dataset_name": "销售周报回归",
                "dataset_hash": "sha256:abc",
                "rubric_id": RUBRIC,
                "rubric_name": "周报标准",
                "rubric_version": 1,
                "rubric_hash": "sha256:def",
                "config": {
                    "dataset": {"id": DATASET, "name": "销售周报回归", "items": _items("第一条", "第二条")},
                    "rubric": _rubric(),
                    "memory_store_ids": [],
                    "concurrency": 1,
                },
                "created_by": "admin",
                "claimed_by": "other",
                "heartbeat_at": datetime.now(timezone.utc) - timedelta(seconds=1000),
            }
        )
        store.insert_result(
            {
                "tenant_id": TENANT,
                "run_id": seeded["id"],
                "item_id": ITEM_A,
                "position": 1,
                "status": "passed",
                "score_milli": 1000,
                "session_id": None,
                "answer": "已有",
                "tool_names": [],
                "stop_reason": "end_turn",
                "rule_results": [],
                "judge": None,
                "usage": {},
                "duration_ms": 1,
                "error": None,
            }
        )
        assert store.requeue_stale() == 1
        assert store.get_run(TENANT, seeded["id"])["status"] == "queued"
        done = await _wait_run(store, seeded["id"], {"completed", "failed"}, timeout=15)
        assert done["status"] == "completed", done.get("error")
        finished = {row["item_id"] for row in store.list_results(seeded["id"])}
        assert finished == {ITEM_A, ITEM_B}
        resumed = next(row for row in store.list_results(seeded["id"]) if row["item_id"] == ITEM_B)
        assert resumed["status"] == "passed"
        assert resumed["session_id"]
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_cancel_stops_dispatch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, http, engine = await _boot(
        tmp_path,
        monkeypatch,
        SequenceFactory([SleepLLM(4), SleepLLM(4), SleepLLM(4)]),
        timeout=1,
        runs=1,
    )
    try:
        created = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json=_body(_items("一", "二", "三"), concurrency=1),
        )
        run_id = created.json()["run"]["id"]
        store = app.state.ma.extras["eval_store"]
        await _wait_run(store, run_id, {"running"}, timeout=5)
        await asyncio.sleep(0.2)
        cancelled = await http.post(
            f"/internal/ma/eval-runs/{run_id}/cancel",
            headers=_headers(),
            json={"tenant_id": TENANT},
        )
        assert cancelled.status_code == 200, cancelled.text
        done = await _wait_run(store, run_id, {"cancelled"}, timeout=10)
        assert done["status"] == "cancelled"
        assert len(store.list_results(run_id)) <= 1
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_iterate_creates_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, http, engine = await _boot(
        tmp_path,
        monkeypatch,
        SequenceFactory([]),
        manifest=_manifest(system="旧提示"),
    )
    store = app.state.ma.extras["eval_store"]
    try:
        base = store.create_run(
            {
                "tenant_id": TENANT,
                "kind": "eval",
                "status": "completed",
                "agent_id": AGENT,
                "agent_version": 1,
                "environment_id": None,
                "dataset_id": DATASET,
                "dataset_name": "销售周报回归",
                "dataset_hash": "sha256:abc",
                "rubric_id": RUBRIC,
                "rubric_name": "周报标准",
                "rubric_version": 1,
                "rubric_hash": "sha256:def",
                "config": {
                    "dataset": {"id": DATASET, "name": "销售周报回归", "items": _items("问题")},
                    "rubric": _rubric(),
                    "memory_store_ids": [],
                    "concurrency": 1,
                },
                "created_by": "admin",
            }
        )
        store.insert_result(
            {
                "tenant_id": TENANT,
                "run_id": base["id"],
                "item_id": ITEM_A,
                "position": 1,
                "status": "failed",
                "score_milli": 100,
                "session_id": None,
                "answer": "没有汇总",
                "tool_names": [],
                "stop_reason": "end_turn",
                "rule_results": [{"type": "contains", "passed": False, "detail": "not found"}],
                "judge": {"score": 0.1, "passed": False, "reason": "缺汇总", "error": None},
                "usage": {},
                "duration_ms": 10,
                "error": None,
            }
        )
        created = await http.post(
            "/internal/ma/eval-iterations",
            headers=_headers(),
            json={
                "tenant_id": TENANT,
                "created_by_user_id": "admin",
                "base_run_id": base["id"],
                "optimizer_model": "fake/scripted",
            },
        )
        assert created.status_code == 201, created.text
        done = await _wait_run(store, created.json()["run"]["id"], {"completed", "failed"}, timeout=10)
        assert done["status"] == "completed", done.get("error")
        with engine.begin() as conn:
            candidate = conn.execute(select(ma_eval_candidates)).mappings().one()
        assert candidate["status"] == "proposed"
        manifest = candidate["manifest"]
        if isinstance(manifest, str):
            manifest = json.loads(manifest)
        diff = candidate["diff"]
        if isinstance(diff, str):
            diff = json.loads(diff)
        assert manifest["system"] == "新提示"
        assert "+新提示" in diff["system"]
        registry = app.state.ma.registry
        assert registry.calls
        assert all(name.startswith("get_") for name in registry.calls)
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_internal_routes_require_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, http, engine = await _boot(tmp_path, monkeypatch, SequenceFactory([]))
    try:
        missing = await http.post("/internal/ma/eval-runs", json=_body(_items("q")))
        assert missing.status_code == 401
        assert missing.json()["error"]["code"] == "unauthorized"
        wrong = await http.post(
            "/internal/ma/eval-runs",
            headers={"Authorization": "Bearer no"},
            json=_body(_items("q")),
        )
        assert wrong.status_code == 401
        extra = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json={**_body(_items("q")), "extra": 1},
        )
        assert extra.status_code == 400
        assert extra.json()["error"]["code"] == "invalid_request"
        created = await http.post(
            "/internal/ma/eval-runs",
            headers=_headers(),
            json=_body(_items("q")),
        )
        assert created.status_code == 201, created.text
        run_id = created.json()["run"]["id"]
        foreign = await http.get(
            f"/internal/ma/eval-runs/{run_id}",
            headers=_headers(),
            params={"tenant_id": "other"},
        )
        assert foreign.status_code == 404
        assert foreign.json()["error"]["code"] == "eval_run_not_found"
        hidden = await http.get("/ma/v1/internal/ma/eval-runs/x")
        assert hidden.status_code in {401, 404}
    finally:
        await _shutdown(app, http, engine)


@pytest.mark.asyncio
async def test_not_wired_when_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    gateway = SimpleNamespace(base_url="http://127.0.0.1:9")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'ma.db'}",
        internal_token="it",
        admin_url="http://admin.test",
        gateway_url="http://127.0.0.1:9/v1",
        gateway_token="agx-pat-gw", # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
    )
    assert settings.evals_enabled is False
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    engine.dispose()
    app = build_app(settings, scrub_env=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    try:
        response = await client.post("/internal/ma/eval-runs", json={})
        assert response.status_code == 404
    finally:
        await client.aclose()
        del gateway
