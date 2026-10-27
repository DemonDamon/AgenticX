#!/usr/bin/env python3
"""Memory dream jobs: public routes, runner, and the admin-console client.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, update

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import HostConfig, Principal
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.protocol import SessionRecord
from agenticx.managed.testing import ScriptStep, ScriptedLLM, StaticLLMFactory

from ma_agent_runtime.memory_dreams import (
    STALE_SECONDS,
    ControlPlaneError,
    DreamControlPlaneClient,
    DreamRunner,
    DreamService,
    DreamStore,
    build_internal_router,
    build_public_router,
)
from ma_agent_runtime.tables import ma_memory_dreams, metadata

TENANT = "T"
OTHER = "OTHER"
INPUT = "01JBX000000000000000000001"
OUTPUT = "01JBX000000000000000000099"
SESSION_A = "01JBX000000000000000000011"
SESSION_B = "01JBX000000000000000000012"
AGENT = "01JBX000000000000000000021"
INTERNAL = "internal-token"


class RecordingFactory(StaticLLMFactory):
    def __init__(self, llm: Any) -> None:
        super().__init__(llm)
        self.contexts: list[LLMCallContext] = []

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        self.contexts.append(context)
        return super().create(provider=provider, model=model, context=context)


class SlowLLM:
    def __init__(self, seconds: float) -> None:
        self._seconds = seconds

    def invoke(self, messages: Any, **kwargs: Any) -> Any:
        del messages, kwargs
        time.sleep(self._seconds)
        return type("Response", (), {"content": "{}"})()


def _principal(tenant: str, *scopes: str) -> Principal:
    return Principal(tenant_id=tenant, user_id="U", scopes=frozenset(scopes))


def _payload(**extra: Any) -> dict[str, Any]:
    body = {
        "input_memory_store_id": INPUT,
        "session_ids": [SESSION_A, SESSION_B],
        "instructions": "按主题整理",
        "model": "zhipu/glm-5",
        "output_memory_store_name": "demo-dream",
    }
    body.update(extra)
    return body


def _model_json() -> str:
    return json.dumps(
        {
            "memories": [{"path": "/topic/tea.md", "content": "prefers tea"}],
            "notes": "kept tea",
        }
    )


async def _seed_session(store: Any, session_id: str, title: str, text: str) -> None:
    now = utc_now_iso()
    await store.create_session(
        SessionRecord(
            id=session_id,
            tenant_id=TENANT,
            agent_id=AGENT,
            agent_version=1,
            source="api",
            status="idle",
            title=title,
            created_at=now,
            updated_at=now,
        )
    )
    await store.append_events(
        TENANT,
        session_id,
        [
            {
                "id": new_ulid(),
                "type": "user.message",
                "content": [{"type": "text", "text": text}],
            }
        ],
    )


async def _boot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    factory: Any,
    handler: Any,
    *,
    timeout: float = 30,
) -> tuple[Any, httpx.AsyncClient, DreamStore, list[dict[str, Any]]]:
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    monkeypatch.setenv("AGX_LEARNING_ENABLED", "0")
    recorded: list[dict[str, Any]] = []

    def transport(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        recorded.append({"method": request.method, "path": request.url.path, "body": body})
        return handler(request, body)

    data = tmp_path / "ma"
    data.mkdir()
    config = HostConfig(
        data_dir=data,
        tenant_id=TENANT,
        tokens={
            "both": _principal(TENANT, "ma:memory:write", "ma:sessions:read", "ma:memory:read"),
            "write": _principal(TENANT, "ma:memory:write"),
            "other": _principal(OTHER, "ma:memory:read"),
        },
        dev=False,
    )
    app = create_ma_app(config, llm_factory=factory)
    engine = create_engine(f"sqlite:///{tmp_path / 'dream.db'}")
    metadata.create_all(engine)
    store = DreamStore(engine)
    client = DreamControlPlaneClient("http://admin.test", INTERNAL, transport=httpx.MockTransport(transport))
    service = DreamService(store, client)
    runner = DreamRunner(
        store=store,
        events=app.state.ma.store,
        client=client,
        llm_factory=factory,
        timeout_seconds=timeout,
        worker_id="dream-test",
        claim_interval_seconds=0.05,
    )
    app.include_router(build_public_router(state=app.state.ma, service=service))
    app.include_router(build_internal_router(service=service, internal_token=INTERNAL))

    async def _shutdown() -> None:
        await runner.stop()
        await client.aclose()

    app.state.ma.startup_hooks.append(runner.start)
    app.state.ma.shutdown_hooks.append(_shutdown)
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    return app, http, store, recorded


async def _shutdown(app: Any, http: httpx.AsyncClient) -> None:
    await http.aclose()
    await app.state.ma.shutdown()


def _happy_admin(request: httpx.Request, body: Any) -> httpx.Response:
    if request.url.path.endswith("/export"):
        return httpx.Response(
            200,
            json={
                "memory_store": {"id": INPUT, "name": "in", "status": "active"},
                "memories": [{"path": "/seed.md", "content": "old"}],
            },
        )
    if request.url.path.endswith("/dream-output"):
        return httpx.Response(201, json={"memory_store": {"id": OUTPUT, "name": "out", "status": "active"}})
    if request.url.path.endswith("/dream-finish"):
        return httpx.Response(200, json={"memory_store": {"id": OUTPUT}})
    return httpx.Response(500, json={"error": {"code": "internal_error", "message": "unexpected"}})


async def _wait(store: DreamStore, dream_id: str) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    for _ in range(80):
        last = store.get(TENANT, dream_id)
        if last is not None and last["status"] in {"completed", "failed", "cancelled"}:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(last)


@pytest.mark.asyncio
async def test_dream_end_to_end(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = RecordingFactory(ScriptedLLM([ScriptStep(_model_json())]))
    app, http, store, recorded = await _boot(tmp_path, monkeypatch, factory, _happy_admin)
    try:
        await _seed_session(app.state.ma.store, SESSION_A, "weekly", "prefer tea")
        await _seed_session(app.state.ma.store, SESSION_B, None, "ship on Friday")
        created = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer both"},
            json=_payload(),
        )
        assert created.status_code == 201, created.text
        dream = created.json()["memory_dream"]
        assert dream["output_memory_store_id"] == OUTPUT
        finished = await _wait(store, dream["id"])
        assert finished["status"] == "completed"
        assert finished["report"]["output_memories"] == 1
        finish = next(item for item in recorded if item["path"].endswith("/dream-finish"))
        assert finish["body"]["outcome"] == "completed"
        assert finish["body"]["memories"] == [{"path": "/topic/tea.md", "content": "prefers tea"}]
        assert factory.contexts[0].agent_id == "ma.memory_dream"
        input_paths = [item["path"] for item in recorded if INPUT in item["path"]]
        assert input_paths == [f"/api/internal/ma/memory-stores/{INPUT}/export"]
    finally:
        await _shutdown(app, http)


@pytest.mark.asyncio
async def test_missing_sessions_and_no_sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = RecordingFactory(ScriptedLLM([ScriptStep(_model_json())]))
    app, http, store, recorded = await _boot(tmp_path, monkeypatch, factory, _happy_admin)
    try:
        created = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer both"},
            json=_payload(session_ids=[SESSION_A]),
        )
        assert created.status_code == 201, created.text
        finished = await _wait(store, created.json()["memory_dream"]["id"])
        assert finished["status"] == "failed"
        assert finished["error"]["type"] == "no_sessions"
        finish = next(item for item in recorded if item["path"].endswith("/dream-finish"))
        assert finish["body"]["outcome"] == "failed"
        assert finish["body"]["memories"] == []
    finally:
        await _shutdown(app, http)


@pytest.mark.asyncio
async def test_timeout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = RecordingFactory(SlowLLM(1.0))
    app, http, store, _recorded = await _boot(tmp_path, monkeypatch, factory, _happy_admin, timeout=0.2)
    try:
        await _seed_session(app.state.ma.store, SESSION_A, None, "hello")
        created = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer both"},
            json=_payload(session_ids=[SESSION_A]),
        )
        assert created.status_code == 201, created.text
        finished = await _wait(store, created.json()["memory_dream"]["id"])
        assert finished["error"]["type"] == "timeout"
    finally:
        await _shutdown(app, http)


@pytest.mark.asyncio
async def test_public_routes_scopes_and_validation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    factory = RecordingFactory(ScriptedLLM([ScriptStep(_model_json())]))
    app, http, store, _recorded = await _boot(tmp_path, monkeypatch, factory, _happy_admin)
    try:
        forbidden = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer write"},
            json=_payload(),
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "forbidden_scope"

        invalid = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer both"},
            json=_payload(session_ids=[]),
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["message"] == "session_ids: must contain 1-100 unique ids"

        created = await http.post(
            "/ma/v1/memory_dreams",
            headers={"Authorization": "Bearer both"},
            json=_payload(session_ids=[SESSION_A]),
        )
        assert created.status_code == 201, created.text
        dream_id = created.json()["memory_dream"]["id"]
        foreign = await http.get(
            f"/ma/v1/memory_dreams/{dream_id}",
            headers={"Authorization": "Bearer other"},
        )
        assert foreign.status_code == 404
        assert foreign.json()["error"]["code"] == "memory_dream_not_found"

        internal = await http.post(
            "/internal/ma/memory-dreams",
            headers={"Authorization": "Bearer wrong"},
            json={"tenant_id": TENANT, **_payload()},
        )
        assert internal.status_code == 401
        assert store.get(TENANT, dream_id) is not None
    finally:
        await _shutdown(app, http)


def test_stale_running_requeued(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'stale.db'}")
    metadata.create_all(engine)
    store = DreamStore(engine)
    created = store.create(
        {
            "tenant_id": TENANT,
            "input_memory_store_id": INPUT,
            "output_memory_store_id": OUTPUT,
            "session_ids": [SESSION_A],
            "instructions": "keep",
            "model": "zhipu/glm-5",
        }
    )
    claimed = store.claim_next("worker-a")
    assert claimed is not None
    old = datetime.now(timezone.utc) - timedelta(seconds=STALE_SECONDS + 5)
    with engine.begin() as conn:
        conn.execute(
            update(ma_memory_dreams)
            .where(ma_memory_dreams.c.id == created["id"])
            .values(heartbeat_at=old)
        )
    assert store.requeue_stale() == 1
    again = store.claim_next("worker-b")
    assert again is not None
    assert again["id"] == created["id"]
    assert again["status"] == "running"
    assert again["claimed_by"] == "worker-b"


@pytest.mark.asyncio
async def test_not_wired_when_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    monkeypatch.setenv("AGX_LEARNING_ENABLED", "0")
    data = tmp_path / "ma"
    data.mkdir()
    config = HostConfig(data_dir=data, tenant_id=TENANT, tokens={}, dev=False)
    app = create_ma_app(config)
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    try:
        response = await http.get("/ma/v1/memory_dreams")
        assert response.status_code == 404
    finally:
        await http.aclose()


@pytest.mark.asyncio
async def test_client_errors_hide_token() -> None:
    token = "dream-secret-token" # gitleaks:allow

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection failed")

    client = DreamControlPlaneClient("http://admin.test", token, transport=httpx.MockTransport(handler))
    try:
        assert token not in repr(client)
        with pytest.raises(ControlPlaneError) as caught:
            await client.export_store(TENANT, INPUT)
        assert token not in str(caught.value)
        assert token not in repr(caught.value)
    finally:
        await client.aclose()
