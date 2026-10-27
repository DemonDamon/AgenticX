#!/usr/bin/env python3
"""Desktop PAT mapping and worker claim authorization.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, select

from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import SessionRecord, Usage

from fakes import DEFAULT_MANIFEST, FakeAdminConsole, agent_record, version_record
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.control_plane import AdminConsoleClient, PatIntrospectionAuthenticator
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.desktop_access import DesktopAccessMiddleware
from ma_agent_runtime.pg_work_queue import ClaimScope, PgWorkQueue, current_claim_scope
from ma_agent_runtime.tables import ma_sessions, ma_work_items, metadata

TENANT = "T"
PAT_A = "agx-pat-dev-a"
PAT_B = "agx-pat-dev-b"
DEVICE = "dev-aaaaaaaa"


def _prepare_db(settings: Settings) -> None:
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    engine.dispose()


def _bundle(
    agent_id: str,
    *,
    assignment_keys: list[str],
    worker_keys: list[str] | None = None,
    lifecycle: str = "published",
) -> dict[str, Any]:
    agent = agent_record(agent_id, TENANT, 1)
    agent["assignment_keys"] = assignment_keys
    agent["worker_keys"] = list(worker_keys or [])
    agent["lifecycle"] = lifecycle
    agent["status"] = "active"
    return {
        "runtime": "cloud",
        "effective": 1,
        "agent": agent,
        "versions": {1: version_record(agent_id, 1, DEFAULT_MANIFEST)},
    }


def _environment(env_id: str, name: str, worker_keys: list[str]) -> dict[str, Any]:
    return {
        "id": env_id,
        "tenant_id": TENANT,
        "name": name,
        "type": "desktop_worker",
        "config": {"type": "desktop_worker", "worker_keys": worker_keys},
        "status": "active",
    }


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _code(response: httpx.Response) -> str:
    body = response.json()
    return str(body["error"]["code"])


async def _boot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fake: FakeAdminConsole,
    *,
    worker: bool = False,
    desktop_pat: bool = False,
    registry_cache: float = 10.0,
    eligibility_cache: float = 30.0,
) -> tuple[Any, httpx.AsyncClient]:
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'ma.db'}",
        internal_token="it",
        admin_url="http://admin.test",
        gateway_url="http://127.0.0.1:9/v1",
        gateway_token="agx-pat-gw", # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
        desktop_worker_enabled=worker,
        desktop_pat_enabled=desktop_pat,
        registry_cache_seconds=registry_cache,
        eligibility_cache_seconds=eligibility_cache,
        implicit_local_env=True,
    )
    _prepare_db(settings)
    app = build_app(settings, admin_transport=fake.transport, scrub_env=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    return app, client


async def _shutdown(app: Any, client: httpx.AsyncClient) -> None:
    await client.aclose()
    await app.state.ma.shutdown()


async def _read_inbox(app: Any, session_id: str, work_id: str) -> str:
    """Read inbox SSE until the replayed client event, then cancel the stream."""
    from urllib.parse import urlencode

    chunks: list[bytes] = []
    started = asyncio.Event()
    seen = asyncio.Event()
    status = {"code": 0}
    sent_request = False

    async def receive() -> dict[str, Any]:
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await seen.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            status["code"] = int(message["status"])
            started.set()
            return
        if message["type"] != "http.response.body":
            return
        chunks.append(message.get("body") or b"")
        if b"user.message" in b"".join(chunks):
            seen.set()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": f"/ma/v1/sessions/{session_id}/inbox/stream",
        "raw_path": f"/ma/v1/sessions/{session_id}/inbox/stream".encode(),
        "query_string": urlencode({"work_id": work_id, "device_id": DEVICE}).encode(),
        "headers": [(b"authorization", f"Bearer {PAT_A}".encode())],
        "server": ("rt", 80),
        "client": ("127.0.0.1", 123),
    }
    task = asyncio.create_task(app(scope, receive, send))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        assert status["code"] == 200, chunks
        await asyncio.wait_for(seen.wait(), timeout=5)
    finally:
        seen.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    return b"".join(chunks).decode()


def _resolver(app: Any) -> Any:
    for item in app.user_middleware:
        if item.cls is DesktopAccessMiddleware:
            return item.kwargs["resolver"]
    raise AssertionError("desktop access middleware is not installed")


async def test_desktop_pat_mapping_respects_flag() -> None:
    fake = FakeAdminConsole()
    client = AdminConsoleClient("http://admin.test", "it", transport=fake.transport)
    try:
        disabled = PatIntrospectionAuthenticator(client, cache_seconds=30, desktop_pat_enabled=False)
        plain = await disabled.authenticate(PAT_A)
        assert plain is not None
        assert plain.scopes == frozenset({"workspace:chat", "desktop:managed"})
        enabled = PatIntrospectionAuthenticator(client, cache_seconds=30, desktop_pat_enabled=True)
        mapped = await enabled.authenticate(PAT_A)
        assert mapped is not None
        assert {"ma:sessions:read", "ma:sessions:write", "ma:worker"} <= mapped.scopes
        assert "ma:admin" not in mapped.scopes
        assert "ma:sessions:on_behalf" not in mapped.scopes
    finally:
        await client.aclose()


async def test_desktop_create_session_rules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = new_ulid()
    blocked_env = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _bundle(agent_id, assignment_keys=["dept:D1"])},
        environments={blocked_env: _environment(blocked_env, "别人的桌面", ["dept:D9"])},
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["all", "UA", "dept:D1"],
                "environments": [],
            },
            (TENANT, "UB"): {"user_id": "UB", "assignment_keys": ["all"], "environments": []},
        },
    )
    app, client = await _boot(
        tmp_path,
        monkeypatch,
        fake,
        desktop_pat=True,
        registry_cache=0,
    )
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "desktop"},
        )
        assert created.status_code == 201, created.text
        assert created.json()["created_by_user_id"] == "UA"
        rejected = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "api"},
        )
        assert rejected.status_code == 400
        assert _code(rejected) == "invalid_request"
        hidden = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_B),
            json={"agent_id": agent_id, "source": "desktop"},
        )
        assert hidden.status_code == 404
        assert _code(hidden) == "agent_not_found"
        fake.agents[agent_id]["agent"]["lifecycle"] = "draft"
        await asyncio.sleep(0.05)
        draft = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "desktop"},
        )
        assert draft.status_code == 404
        assert _code(draft) == "agent_not_found"
        fake.agents[agent_id]["agent"]["lifecycle"] = "published"
        await asyncio.sleep(0.05)
        wrong_env = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "desktop", "environment_id": blocked_env},
        )
        assert wrong_env.status_code == 404, wrong_env.text
        assert _code(wrong_env) == "environment_not_found"
    finally:
        await _shutdown(app, client)


async def test_desktop_session_isolation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _bundle(agent_id, assignment_keys=["dept:D1"])},
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": TENANT,
                "user_id": "SVC",
                "scopes": ["ma:sessions:read", "ma:sessions:write"],
            }
        },
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["dept:D1"],
                "environments": [],
            }
        },
    )
    app, client = await _boot(tmp_path, monkeypatch, fake, desktop_pat=True)
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "desktop"},
        )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        for method, path in (
            ("GET", f"/ma/v1/sessions/{sid}"),
            ("GET", f"/ma/v1/sessions/{sid}/events"),
            ("POST", f"/ma/v1/sessions/{sid}/events"),
            ("GET", f"/ma/v1/sessions/{sid}/events/stream"),
        ):
            response = await client.request(
                method,
                path,
                headers=_auth(PAT_B),
                json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "x"}]}]}
                if method == "POST"
                else None,
            )
            assert response.status_code == 404, (method, path, response.text)
            assert _code(response) == "session_not_found"
        own = await client.get(f"/ma/v1/sessions/{sid}", headers=_auth(PAT_A))
        assert own.status_code == 200, own.text
        service = await client.get(f"/ma/v1/sessions/{sid}", headers=_auth("agx-pat-svc"))
        assert service.status_code == 200, service.text
    finally:
        await _shutdown(app, client)


async def test_poll_requires_eligible_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    allowed = new_ulid()
    blocked = new_ulid()
    record = _environment(allowed, "研发桌面", ["dept:D1"])
    fake = FakeAdminConsole(
        environments={allowed: record},
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["dept:D1"],
                "environments": [record],
            }
        },
    )
    app, client = await _boot(tmp_path, monkeypatch, fake, worker=True, desktop_pat=True)
    try:
        denied = await client.post(
            f"/ma/v1/environments/{blocked}/work/poll",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE, "max_wait_seconds": 0},
        )
        assert denied.status_code == 404
        assert _code(denied) == "environment_not_found"
        empty = await client.post(
            f"/ma/v1/environments/{allowed}/work/poll",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE, "max_wait_seconds": 0},
        )
        assert empty.status_code == 200, empty.text
        assert empty.json()["work"] is None
        listed = await client.get("/ma/v1/work/environments", headers=_auth(PAT_A))
        assert listed.status_code == 200, listed.text
        assert listed.json()["data"] == [{"id": allowed, "name": "研发桌面"}]
    finally:
        await _shutdown(app, client)


async def test_claim_filters_agent_and_desktop_owner(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_id = new_ulid()
    agent_x = new_ulid()
    agent_y = new_ulid()
    record = _environment(env_id, "研发桌面", ["dept:D1"])
    fake = FakeAdminConsole(
        agents={
            agent_x: _bundle(agent_x, assignment_keys=["dept:D1"], worker_keys=["dept:D9"]),
            agent_y: _bundle(agent_y, assignment_keys=["dept:D1"], worker_keys=[]),
        },
        environments={env_id: record},
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["dept:D1"],
                "environments": [record],
            }
        },
    )
    app, client = await _boot(tmp_path, monkeypatch, fake, worker=True, desktop_pat=True)
    try:
        queue = app.state.ma.extras["work_queue"]
        base = datetime(2026, 10, 25, tzinfo=timezone.utc)
        step = {"n": 0}

        def clock() -> datetime:
            step["n"] += 1
            return base + timedelta(seconds=step["n"])

        queue._clock = clock
        sessions = [
            (new_ulid(), agent_x, "api", "UA"),
            (new_ulid(), agent_y, "desktop", "UB"),
            (new_ulid(), agent_y, "api", "UA"),
        ]
        for session_id, agent_id, source, owner in sessions:
            await app.state.ma.store.create_session(
                SessionRecord(
                    id=session_id,
                    tenant_id=TENANT,
                    agent_id=agent_id,
                    agent_version=1,
                    environment_id=env_id,
                    created_by_user_id=owner,
                    source=source,
                    status="idle",
                    usage=Usage(),
                    created_at="2026-10-25T00:00:00.000Z",
                    updated_at="2026-10-25T00:00:00.000Z",
                )
            )
            queue.create(
                tenant_id=TENANT,
                session_id=session_id,
                environment_id=env_id,
                inbox_after_seq=0,
            )
        polled = await client.post(
            f"/ma/v1/environments/{env_id}/work/poll",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE, "max_wait_seconds": 0},
        )
        assert polled.status_code == 200, polled.text
        body = polled.json()
        assert body["session"]["id"] == sessions[2][0]
        work_id = body["work"]["id"]
        with queue._engine.connect() as conn:
            owner = conn.execute(
                select(ma_work_items.c.claimed_by_user_id).where(ma_work_items.c.id == work_id)
            ).scalar_one()
        assert owner == "UA"
    finally:
        await _shutdown(app, client)


async def test_lease_bound_to_user(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_id = new_ulid()
    agent_id = new_ulid()
    record = _environment(env_id, "研发桌面", ["dept:D1"])
    fake = FakeAdminConsole(
        agents={agent_id: _bundle(agent_id, assignment_keys=["dept:D1"], worker_keys=[])},
        environments={env_id: record},
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["dept:D1"],
                "environments": [record],
            },
            (TENANT, "UB"): {
                "user_id": "UB",
                "assignment_keys": ["dept:D1"],
                "environments": [record],
            },
        },
    )
    app, client = await _boot(tmp_path, monkeypatch, fake, worker=True, desktop_pat=True)
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "environment_id": env_id, "source": "desktop"},
        )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=_auth(PAT_A),
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
        )
        assert posted.status_code == 200, posted.text
        polled = await client.post(
            f"/ma/v1/environments/{env_id}/work/poll",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE, "max_wait_seconds": 0},
        )
        assert polled.status_code == 200, polled.text
        work_id = polled.json()["work"]["id"]
        stolen = await client.post(
            f"/ma/v1/work/{work_id}/ack",
            headers=_auth(PAT_B),
            json={"device_id": DEVICE},
        )
        assert stolen.status_code == 409
        assert _code(stolen) == "work_lease_lost"
        ingested = await client.post(
            f"/ma/v1/sessions/{sid}/events:ingest",
            headers=_auth(PAT_B),
            json={
                "work_id": work_id,
                "device_id": DEVICE,
                "events": [{"type": "agent.message", "content": [{"type": "text", "text": "no"}]}],
            },
        )
        assert ingested.status_code == 409
        assert _code(ingested) == "work_lease_lost"
        acked = await client.post(
            f"/ma/v1/work/{work_id}/ack",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE},
        )
        assert acked.status_code == 200, acked.text
        # httpx ASGITransport waits for the whole app call, so an open SSE
        # response never returns. Drive the same stack with ASGI 2.4, which
        # keeps the body iterator on this task (where the claim scope is set).
        streamed = await _read_inbox(app, sid, work_id)
        assert "user.message" in streamed
    finally:
        await _shutdown(app, client)


async def test_flags_off_keeps_e03_behaviour(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = new_ulid()
    fake = FakeAdminConsole(agents={agent_id: _bundle(agent_id, assignment_keys=["dept:D1"])})
    app, client = await _boot(tmp_path, monkeypatch, fake, worker=False, desktop_pat=False)
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=_auth(PAT_A),
            json={"agent_id": agent_id, "source": "desktop"},
        )
        assert created.status_code == 403
        assert _code(created) == "forbidden_scope"
        polled = await client.post(
            f"/ma/v1/environments/{new_ulid()}/work/poll",
            headers=_auth(PAT_A),
            json={"device_id": DEVICE, "max_wait_seconds": 0},
        )
        assert polled.status_code == 404
    finally:
        await _shutdown(app, client)


async def test_eligibility_cache_ttl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_id = new_ulid()
    record = _environment(env_id, "研发桌面", ["dept:D1"])
    fake = FakeAdminConsole(
        environments={env_id: record},
        worker_eligibility={
            (TENANT, "UA"): {
                "user_id": "UA",
                "assignment_keys": ["dept:D1"],
                "environments": [record],
            }
        },
    )
    app, client = await _boot(
        tmp_path,
        monkeypatch,
        fake,
        worker=True,
        desktop_pat=True,
        eligibility_cache=30,
    )

    class _Clock:
        def __init__(self) -> None:
            self.now = 1000.0

        def __call__(self) -> float:
            return self.now

    clock = _Clock()
    _resolver(app)._cache._clock = clock
    try:

        async def poll() -> None:
            response = await client.post(
                f"/ma/v1/environments/{env_id}/work/poll",
                headers=_auth(PAT_A),
                json={"device_id": DEVICE, "max_wait_seconds": 0},
            )
            assert response.status_code == 200, response.text

        def hits() -> int:
            return sum(1 for item in fake.requests if item.url.path.endswith("/worker-eligibility"))

        await poll()
        await poll()
        assert hits() == 1
        clock.now += 31
        await poll()
        assert hits() == 2
    finally:
        await _shutdown(app, client)


def test_scoped_claim_records_user(work_queue: PgWorkQueue) -> None:
    tenant = TENANT
    session_id = new_ulid()
    env_id = new_ulid()
    agent_id = new_ulid()
    now = datetime(2026, 10, 25, tzinfo=timezone.utc)
    with work_queue._engine.begin() as conn:
        conn.execute(
            ma_sessions.insert().values(
                id=session_id,
                tenant_id=tenant,
                agent_id=agent_id,
                agent_version=1,
                environment_id=env_id,
                created_by_user_id="UA",
                source="api",
                status="idle",
                vault_ids=[],
                resources=[],
                usage_totals={},
                last_seq=0,
                created_at=now,
                updated_at=now,
            )
        )
    created = work_queue.create(
        tenant_id=tenant,
        session_id=session_id,
        environment_id=env_id,
        inbox_after_seq=0,
    )
    token = current_claim_scope.set(ClaimScope("UA", frozenset({agent_id})))
    try:
        claimed = work_queue.claim_next(tenant, env_id, DEVICE)
    finally:
        current_claim_scope.reset(token)
    assert claimed is not None
    assert claimed.id == created.id
    with work_queue._engine.connect() as conn:
        owner = conn.execute(
            select(ma_work_items.c.claimed_by_user_id).where(ma_work_items.c.id == created.id)
        ).scalar_one()
    assert owner == "UA"
