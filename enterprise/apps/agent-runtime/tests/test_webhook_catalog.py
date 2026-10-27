#!/usr/bin/env python3
"""Webhook catalog events, resource enqueue, and automatic disable.

Author: Damon Li
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.config import Principal
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord

from conftest import Clock
from fakes import FakeAdminConsole
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.control_plane import AdminConsoleClient
from ma_agent_runtime.db import build_engines
from ma_agent_runtime.pg_event_store import PgEventStore
from ma_agent_runtime.scheduler import ScheduleTicker
from ma_agent_runtime.session_hooks import HookedPgEventStore
from ma_agent_runtime.tables import ma_schedule_runs, ma_webhook_deliveries
from ma_agent_runtime.webhook_events_routes import build_internal_router
from ma_agent_runtime.webhooks import (
    LEGACY_WEBHOOK_EVENT_TYPES,
    RESOURCE_EVENT_TYPES,
    SCHEDULE_RUN_EVENT_TYPES,
    SESSION_EVENT_MAP,
    WebhookConfigCache,
    WebhookDeliverer,
    WebhookOutbox,
    all_webhook_event_types,
)

_CATALOG_TS = (
    Path(__file__).resolve().parents[3] / "packages" / "core-api" / "src" / "managed-agents.ts"
)
_SESSION_KEYS = {"type", "tenant_id", "session_id", "agent_id", "agent_version", "source"}
_THREAD_KEYS = {"type", "tenant_id", "session_id", "agent_id", "thread_id"}
_RUN_KEYS = {
    "type",
    "tenant_id",
    "schedule_id",
    "schedule_run_id",
    "agent_id",
    "session_id",
    "error",
}


def _catalog_groups_defined() -> bool:
    if not _CATALOG_TS.is_file():
        return False
    return "MA_WEBHOOK_EVENT_GROUPS" in _CATALOG_TS.read_text(encoding="utf-8")


class StaticCache:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    async def get(self) -> list[dict[str, Any]]:
        return list(self.rows)


def _secret() -> str:
    return "whsec_" + base64.b64encode(b"k" * 32).decode("ascii")


def _hook(**extra: Any) -> dict[str, Any]:
    body = {
        "id": extra.pop("id", new_ulid()),
        "tenant_id": "T",
        "url": "https://203.0.113.10/hook",
        "event_types": ["session.idle"],
        "agent_ids": [],
        "sources": [],
        "include_result_text": False,
        "signing_secret": _secret(),
        "failure_reset_at": None,
    }
    body.update(extra)
    return body


def _session(**extra: Any) -> SessionRecord:
    now = utc_now_iso()
    values: dict[str, Any] = {
        "id": new_ulid(),
        "tenant_id": "T",
        "agent_id": "A",
        "agent_version": 3,
        "source": "api",
        "status": "idle",
        "created_by_user_id": "U",
        "created_at": now,
        "updated_at": now,
    }
    values.update(extra)
    return SessionRecord(**values)


def _data(row: dict[str, Any]) -> dict[str, Any]:
    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    assert isinstance(payload, dict)
    data = payload["data"]
    assert isinstance(data, dict)
    return data


async def _rows(engine: Any) -> list[dict[str, Any]]:
    async with engine.connect() as conn:
        found = (await conn.execute(select(ma_webhook_deliveries))).mappings().all()
    return [dict(row) for row in found]


def _by(rows: list[dict[str, Any]], hook_id: str, event_type: str | None = None) -> list[dict[str, Any]]:
    found = [row for row in rows if row["webhook_id"] == hook_id]
    if event_type is None:
        return found
    return [row for row in found if row["event_type"] == event_type]


def _env(tmp_path: Path, **overrides: str) -> dict[str, str]:
    home = str(tmp_path / "home")
    base = {
        "DATABASE_URL": "postgresql://u:p@127.0.0.1:5432/db",
        "MA_INTERNAL_TOKEN": "internal",
        "MA_RUNTIME_GATEWAY_TOKEN": "agx-pat-gateway",
        "MA_RUNTIME_HOME": home,
        "HOME": home,
    }
    base.update(overrides)
    return base


@pytest.fixture
async def hooked(sqlite_urls: Any):
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    store = HookedPgEventStore(async_engine)
    try:
        yield async_engine, store
    finally:
        await store.drain()
        await store.close()
        sync_engine.dispose()


def test_python_catalog_counts_29() -> None:
    assert len(frozenset(SESSION_EVENT_MAP.values())) == 5
    assert len(SCHEDULE_RUN_EVENT_TYPES) == 3
    assert len(RESOURCE_EVENT_TYPES) == 18
    assert len(LEGACY_WEBHOOK_EVENT_TYPES) == 3
    assert len(all_webhook_event_types()) == 29


def test_auto_disable_settings_bounds(tmp_path: Path) -> None:
    settings = Settings.from_env(_env(tmp_path))
    assert settings.webhook_auto_disable_failures == 20
    assert settings.webhook_auto_disable_hours == 24
    custom = Settings.from_env(
        _env(tmp_path, MA_WEBHOOK_AUTO_DISABLE_FAILURES="3", MA_WEBHOOK_AUTO_DISABLE_HOURS="0")
    )
    assert custom.webhook_auto_disable_failures == 3
    assert custom.webhook_auto_disable_hours == 0
    with pytest.raises(RuntimeError, match=r"^MA_WEBHOOK_AUTO_DISABLE_FAILURES:"):
        Settings.from_env(_env(tmp_path, MA_WEBHOOK_AUTO_DISABLE_FAILURES="0"))
    with pytest.raises(RuntimeError, match=r"^MA_WEBHOOK_AUTO_DISABLE_FAILURES:"):
        Settings.from_env(_env(tmp_path, MA_WEBHOOK_AUTO_DISABLE_FAILURES="1001"))
    with pytest.raises(RuntimeError, match=r"^MA_WEBHOOK_AUTO_DISABLE_HOURS:"):
        Settings.from_env(_env(tmp_path, MA_WEBHOOK_AUTO_DISABLE_HOURS="721"))
    with pytest.raises(RuntimeError, match=r"^MA_WEBHOOK_AUTO_DISABLE_HOURS:"):
        Settings.from_env(_env(tmp_path, MA_WEBHOOK_AUTO_DISABLE_HOURS="nope"))


@pytest.mark.asyncio
async def test_terminal_listener_order_unchanged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = (tmp_path / "home").resolve()
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'ma.db'}",
        internal_token="it",
        admin_url="http://admin.test",
        gateway_url="http://127.0.0.1:9/v1",
        gateway_token="agx-pat-gw",  # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
        scheduler_enabled=True,
        webhooks_enabled=True,
    )
    app = build_app(settings, scrub_env=False)
    try:
        quals = [listener.__func__.__qualname__ for listener in app.state.ma.store._listeners]
        assert quals == ["ScheduleTicker.on_terminal", "WebhookOutbox.on_terminal"]
        assert len(app.state.ma.store._event_listeners) == 1
        types, listener = app.state.ma.store._event_listeners[0]
        assert types == frozenset(SESSION_EVENT_MAP)
        assert listener.__func__.__qualname__ == "WebhookOutbox.on_session_event"
        paths = {getattr(route, "path", "") for route in app.routes}
        assert "/internal/ma/webhook-events" in paths
        assert "/internal/ma/webhooks/{webhook_id}/deliveries" in paths
    finally:
        await app.state.ma.shutdown()


@pytest.mark.asyncio
async def test_ac_s2_1_run_started_enqueues_for_subscribers(hooked: Any) -> None:
    engine, store = hooked
    match = _hook(event_types=["session.status_run_started"], sources=["api"], agent_ids=["A"])
    other_source = _hook(event_types=["session.status_run_started"], sources=["schedule"], agent_ids=["A"])
    unsubscribed = _hook(event_types=["session.idle"], sources=["api"], agent_ids=["A"])
    other_tenant = _hook(
        tenant_id="OTHER",
        event_types=["session.status_run_started"],
        sources=["api"],
        agent_ids=["A"],
    )
    outbox = WebhookOutbox(
        engine=engine,
        cache=StaticCache([match, other_source, unsubscribed, other_tenant]),
        store=store,
    )
    store.add_event_listener(outbox.on_session_event, frozenset(SESSION_EVENT_MAP))
    session = _session()
    await store.create_session(session)
    stored = await store.append_events("T", session.id, [{"type": "session.status_running"}])
    await store.drain()
    rows = await _rows(engine)
    matched = _by(rows, match["id"])
    assert len(matched) == 1
    assert _by(rows, other_source["id"]) == []
    assert _by(rows, unsubscribed["id"]) == []
    assert _by(rows, other_tenant["id"]) == []
    data = _data(matched[0])
    assert data["type"] == "session.status_run_started"
    assert set(data) == _SESSION_KEYS
    assert data["session_id"] == session.id
    assert data["agent_id"] == "A"
    assert data["source"] == "api"
    assert matched[0]["event_key"] == f"session.status_run_started:{stored[0].id}"


@pytest.mark.asyncio
async def test_ac_s2_2_idle_emits_legacy_and_idled(hooked: Any) -> None:
    engine, store = hooked
    idle = _hook(event_types=["session.idle"])
    idled = _hook(event_types=["session.status_idled"])
    failed = _hook(event_types=["session.failed"])
    outbox = WebhookOutbox(engine=engine, cache=StaticCache([idle, idled, failed]), store=store)
    store.add_terminal_listener(outbox.on_terminal)
    store.add_event_listener(outbox.on_session_event, frozenset(SESSION_EVENT_MAP))
    session = _session()
    await store.create_session(session)
    await store.append_events(
        "T",
        session.id,
        [{"type": "session.status_idle", "stop_reason": {"type": "requires_action", "event_ids": []}}],
    )
    await store.drain()
    rows = await _rows(engine)
    idle_rows = _by(rows, idle["id"])
    idled_rows = _by(rows, idled["id"])
    assert len(idle_rows) == 1
    assert len(idled_rows) == 1
    assert _by(rows, failed["id"]) == []
    legacy = _data(idle_rows[0])
    assert legacy["type"] == "session.idle"
    assert legacy["stop_reason"] == {"type": "requires_action"}
    assert "schedule_id" in legacy
    assert "result_text" not in legacy
    fresh = _data(idled_rows[0])
    assert fresh["type"] == "session.status_idled"
    assert fresh["stop_reason"] == {"type": "requires_action"}
    assert set(fresh) == _SESSION_KEYS | {"stop_reason"}
    assert "schedule_id" not in fresh
    assert "result_text" not in fresh


@pytest.mark.asyncio
async def test_ac_s2_3_thread_events_include_thread_id(hooked: Any) -> None:
    engine, store = hooked
    hook = _hook(
        event_types=[
            "session.thread_created",
            "session.thread_idled",
            "session.thread_terminated",
        ],
        sources=["api"],
        agent_ids=["A"],
    )
    blocked = _hook(
        event_types=[
            "session.thread_created",
            "session.thread_idled",
            "session.thread_terminated",
        ],
        sources=["schedule"],
    )
    outbox = WebhookOutbox(engine=engine, cache=StaticCache([hook, blocked]), store=store)
    store.add_event_listener(outbox.on_session_event, frozenset(SESSION_EVENT_MAP))
    session = _session()
    await store.create_session(session)
    thread_id = new_ulid()
    await store.append_events(
        "T",
        session.id,
        [
            {
                "type": "session.thread_created",
                "thread_id": thread_id,
                "agent": {
                    "type": "subagent",
                    "agent_id": "member-1",
                    "agent_version": 2,
                    "name": "M",
                },
                "parent_thread_id": None,
            },
            {
                "type": "session.thread_status_idle",
                "thread_id": thread_id,
                "stop_reason": {"type": "end_turn", "event_ids": []},
            },
            {
                "type": "session.thread_status_terminated",
                "thread_id": thread_id,
                "reason": "completed",
            },
        ],
    )
    await store.drain()
    rows = await _rows(engine)
    assert _by(rows, blocked["id"]) == []
    by_type = {row["event_type"]: _data(row) for row in _by(rows, hook["id"])}
    assert set(by_type) == {
        "session.thread_created",
        "session.thread_idled",
        "session.thread_terminated",
    }
    assert by_type["session.thread_created"]["thread_id"] == thread_id
    assert by_type["session.thread_created"]["thread_agent_id"] == "member-1"
    assert by_type["session.thread_created"]["agent_id"] == "A"
    assert set(by_type["session.thread_created"]) == _THREAD_KEYS | {"thread_agent_id"}
    assert by_type["session.thread_idled"]["thread_id"] == thread_id
    assert set(by_type["session.thread_idled"]) == _THREAD_KEYS
    assert by_type["session.thread_terminated"]["thread_id"] == thread_id
    assert by_type["session.thread_terminated"]["reason"] == "completed"
    assert set(by_type["session.thread_terminated"]) == _THREAD_KEYS | {"reason"}


class _Sessions:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.store = _SessionStore()

    async def create_session(self, principal: Principal, req: Any) -> SessionRecord:
        now = utc_now_iso()
        record = SessionRecord(
            id=new_ulid(),
            tenant_id=principal.tenant_id,
            agent_id=req.agent_id,
            agent_version=req.agent_version or 1,
            environment_id=req.environment_id,
            created_by_user_id=principal.user_id,
            source=req.source,
            status="idle",
            title=req.title,
            vault_ids=list(req.vault_ids or []),
            resources=list(req.resources or []),
            created_at=now,
            updated_at=now,
        )
        self.store.sessions[(record.tenant_id, record.id)] = record
        return record

    async def post_events(self, _principal: Principal, session_id: str, raw: dict[str, Any]) -> list[Any]:
        self.events.append((session_id, raw))
        return []


class _SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], SessionRecord] = {}

    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        return self.sessions.get((tenant_id, session_id))


def _schedule(**extra: Any) -> dict[str, Any]:
    body = {
        "id": extra.pop("id", new_ulid()),
        "tenant_id": "T",
        "name": "日报",
        "agent_id": "agent-1",
        "version_policy": "follow_routing",
        "pinned_version": None,
        "environment_id": None,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "input_template": "现在 {{datetime}} {{schedule_name}}",
        "vault_ids": [],
        "resources": [],
        "run_as_user_id": "user-1",
        "enabled": True,
        "revision": 1,
        "misfire_grace_seconds": 300,
        "manual_run_requested_at": None,
    }
    body.update(extra)
    return body


async def _insert_run(engine: Any, **values: Any) -> str:
    run_id = values.pop("id", new_ulid())
    now = values.pop("now")
    payload = {
        "id": run_id,
        "tenant_id": "T",
        "schedule_revision": 1,
        "trigger": "schedule",
        "status": "scheduled",
        "created_at": now,
        "updated_at": now,
    }
    payload.update(values)
    async with engine.begin() as conn:
        await conn.execute(ma_schedule_runs.insert().values(**payload))
    return run_id


async def _run_rows(engine: Any) -> list[dict[str, Any]]:
    async with engine.connect() as conn:
        found = (await conn.execute(select(ma_schedule_runs))).mappings().all()
    return [dict(row) for row in found]


@pytest.mark.asyncio
async def test_ac_s2_4_schedule_run_events(sqlite_urls: Any) -> None:
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=4)
    store = PgEventStore(async_engine)
    clock = Clock()
    clock.now = datetime(2026, 10, 23, 2, 0, tzinfo=timezone.utc)
    schedule = _schedule()
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = _Sessions()
    client = AdminConsoleClient("http://admin.test", "token", transport=fake.transport)
    ok = _hook(
        event_types=["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"],
        agent_ids=["agent-1"],
    )
    other_agent = _hook(
        event_types=["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"],
        agent_ids=["someone-else"],
    )
    source_ignored = _hook(
        event_types=["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"],
        sources=["feishu"],
    )
    outbox = WebhookOutbox(
        engine=async_engine,
        cache=StaticCache([ok, other_agent, source_ignored]),
        store=store,
        clock=clock,
    )
    ticker = ScheduleTicker(
        engine=async_engine,
        client=client,
        service=sessions,
        settings=SimpleNamespace(scheduler_tick_seconds=15, schedule_run_timeout_seconds=3600),
        clock=clock,
        on_run_event=outbox.enqueue_schedule_run_event,
    )
    try:
        await ticker.tick()
        planned = (await _run_rows(async_engine))[0]["scheduled_for"]
        if planned.tzinfo is None:
            planned = planned.replace(tzinfo=timezone.utc)
        clock.now = planned.astimezone(timezone.utc)
        await ticker.tick()
        await ticker.tick()
        rows = await _rows(async_engine)
        assert len(_by(rows, ok["id"], "schedule_run.started")) == 1
        assert len(_by(rows, source_ignored["id"], "schedule_run.started")) == 1
        assert _by(rows, other_agent["id"]) == []
        running = [row for row in await _run_rows(async_engine) if row["status"] == "running"]
        assert len(running) == 1
        started = _data(_by(rows, ok["id"], "schedule_run.started")[0])
        assert set(started) == _RUN_KEYS
        assert started["type"] == "schedule_run.started"
        assert started["schedule_id"] == schedule["id"]
        assert started["schedule_run_id"] == running[0]["id"]
        assert started["agent_id"] == "agent-1"
        assert started["session_id"] == running[0]["session_id"]
        assert started["error"] is None
        session_id = str(running[0]["session_id"])
        event = StoredEvent(
            new_ulid(),
            "T",
            session_id,
            1,
            "session.status_idle",
            {"stop_reason": {"type": "end_turn"}},
            "2026-10-26T01:00:00.000Z",
        )
        await ticker.on_terminal("T", session_id, event)
        await ticker.on_terminal("T", session_id, event)
        rows = await _rows(async_engine)
        succeeded = _by(rows, ok["id"], "schedule_run.succeeded")
        assert len(succeeded) == 1
        assert len(_by(rows, source_ignored["id"], "schedule_run.succeeded")) == 1
        done = _data(succeeded[0])
        assert done["schedule_run_id"] == running[0]["id"]
        assert done["session_id"] == session_id
        assert done["error"] is None
        assert succeeded[0]["event_key"] == f"schedule_run.succeeded:{running[0]['id']}"
        stale_session = new_ulid()
        sessions.store.sessions[("T", stale_session)] = _session(
            id=stale_session,
            agent_id="agent-1",
            source="schedule",
            created_by_user_id="user-1",
        )
        stale_schedule = new_ulid()
        stale_id = await _insert_run(
            async_engine,
            schedule_id=stale_schedule,
            session_id=stale_session,
            status="running",
            started_at=clock.now - timedelta(seconds=3601),
            scheduled_for=clock.now - timedelta(seconds=3601),
            now=clock.now,
        )
        await ticker.tick()
        rows = await _rows(async_engine)
        failed = _by(rows, ok["id"], "schedule_run.failed")
        assert len(failed) == 1
        assert len(_by(rows, ok["id"], "schedule_run.started")) == 1
        body = _data(failed[0])
        assert body["error"] == "timeout"
        assert body["schedule_run_id"] == stale_id
        assert body["session_id"] == stale_session
        assert body["schedule_id"] == stale_schedule
        assert failed[0]["event_key"] == f"schedule_run.failed:{stale_id}"
    finally:
        await client.aclose()
        await store.close()
        sync_engine.dispose()


def _resource(event_type: str, resource_id: str, **extra: Any) -> dict[str, Any]:
    body = {
        "id": extra.pop("id", new_ulid()),
        "tenant_id": extra.pop("tenant_id", "T"),
        "type": event_type,
        "resource_id": resource_id,
        "occurred_at": "2026-10-26T01:02:03.000Z",
    }
    body.update(extra)
    return body


@pytest.mark.asyncio
async def test_ac_s2_5_resource_event_route(sqlite_urls: Any) -> None:
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    store = PgEventStore(async_engine)
    subscribed = _hook(
        event_types=[
            "agent.created",
            "agent.version_published",
            "environment.created",
            "vault_credential.created",
            "schedule.created",
        ],
        agent_ids=["A"],
        sources=["feishu"],
    )
    other_agent = _hook(event_types=["agent.created"], agent_ids=["B"])
    other_tenant = _hook(tenant_id="OTHER", event_types=["agent.created"], agent_ids=[])
    outbox = WebhookOutbox(
        engine=async_engine,
        cache=StaticCache([subscribed, other_agent, other_tenant]),
        store=store,
    )
    app = FastAPI()
    app.include_router(build_internal_router(SimpleNamespace(internal_token="secret"), outbox, async_engine))
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    try:
        missing = await http.post("/internal/ma/webhook-events", json=_resource("agent.created", "A"))
        assert missing.status_code == 401
        rejected = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("deployment.created", "A"),
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "invalid_request"
        created = _resource("agent.created", "A")
        first = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=created,
        )
        assert first.status_code == 200
        assert first.json()["data"]["enqueued"] == 1
        again = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=created,
        )
        assert again.status_code == 200
        assert again.json()["data"]["enqueued"] == 0
        for_b = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("agent.created", "B"),
        )
        assert for_b.json()["data"]["enqueued"] == 1
        environment = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("environment.created", "env-1"),
        )
        assert environment.json()["data"]["enqueued"] == 1
        published = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("agent.version_published", "A", version=4),
        )
        assert published.json()["data"]["enqueued"] == 1
        credential = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("vault_credential.created", "cred-1", vault_id="vault-1"),
        )
        assert credential.json()["data"]["enqueued"] == 1
        scheduled = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("schedule.created", "sched-1", agent_id="A"),
        )
        assert scheduled.json()["data"]["enqueued"] == 1
        other = await http.post(
            "/internal/ma/webhook-events",
            headers={"Authorization": "Bearer secret"},
            json=_resource("agent.created", "A", tenant_id="OTHER"),
        )
        assert other.json()["data"]["enqueued"] == 1
        rows = await _rows(async_engine)
        assert len(_by(rows, subscribed["id"], "agent.created")) == 1
        assert len(_by(rows, other_agent["id"], "agent.created")) == 1
        assert _data(_by(rows, other_agent["id"], "agent.created")[0])["resource_id"] == "B"
        assert len(_by(rows, other_tenant["id"])) == 1
        created_data = _data(_by(rows, subscribed["id"], "agent.created")[0])
        assert created_data["agent_id"] == "A"
        assert created_data["resource_type"] == "agent"
        assert created_data["resource_id"] == "A"
        assert "vault_id" not in created_data
        env_data = _data(_by(rows, subscribed["id"], "environment.created")[0])
        assert env_data["resource_type"] == "environment"
        assert "agent_id" not in env_data
        version_data = _data(_by(rows, subscribed["id"], "agent.version_published")[0])
        assert version_data["version"] == 4
        assert version_data["agent_id"] == "A"
        cred_data = _data(_by(rows, subscribed["id"], "vault_credential.created")[0])
        assert cred_data["vault_id"] == "vault-1"
        assert cred_data["resource_type"] == "vault_credential"
        assert "agent_id" not in cred_data
        assert "secret" not in cred_data
        sched_data = _data(_by(rows, subscribed["id"], "schedule.created")[0])
        assert sched_data["agent_id"] == "A"
        assert _by(rows, subscribed["id"], "agent.created")[0]["event_key"] == f"agent.created:{created['id']}"
        assert _by(rows, subscribed["id"], "agent.created")[0]["event_id"] == created["id"]
    finally:
        await http.aclose()
        await store.close()
        sync_engine.dispose()


async def _delivery(
    engine: Any,
    *,
    webhook_id: str,
    created_at: datetime,
    tenant_id: str = "T",
    status: str = "succeeded",
    attempts: int = 1,
    delivered_at: datetime | None = None,
    last_status_code: int | None = 204,
    last_error: str | None = None,
) -> str:
    delivery_id = new_ulid()
    event_id = new_ulid()
    async with engine.begin() as conn:
        await conn.execute(
            ma_webhook_deliveries.insert().values(
                id=delivery_id,
                tenant_id=tenant_id,
                webhook_id=webhook_id,
                event_id=event_id,
                event_type="environment.created",
                event_key=f"environment.created:{event_id}",
                payload={"type": "event", "id": event_id, "marker": "secret-payload"},
                status=status,
                attempts=attempts,
                next_attempt_at=created_at,
                last_status_code=last_status_code,
                last_error=last_error,
                delivered_at=delivered_at,
                created_at=created_at,
                updated_at=created_at,
            )
        )
    return delivery_id


@pytest.mark.asyncio
async def test_ac_s5_1_list_deliveries(sqlite_urls: Any) -> None:
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    store = PgEventStore(async_engine)
    outbox = WebhookOutbox(engine=async_engine, cache=StaticCache([]), store=store)
    app = FastAPI()
    app.include_router(build_internal_router(SimpleNamespace(internal_token="secret"), outbox, async_engine))
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    hook = new_ulid()
    other_hook = new_ulid()
    oldest = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
    middle_at = datetime(2026, 10, 26, 2, 0, tzinfo=timezone.utc)
    newest = datetime(2026, 10, 26, 3, 0, tzinfo=timezone.utc)
    later = datetime(2026, 10, 26, 5, 0, tzinfo=timezone.utc)
    try:
        missing = await http.get(f"/internal/ma/webhooks/{hook}/deliveries", params={"tenant_id": "T"})
        assert missing.status_code == 401
        rejected = await http.get(
            f"/internal/ma/webhooks/{hook}/deliveries",
            headers={"Authorization": "Bearer secret"},
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "invalid_request"
        bad_limit = await http.get(
            f"/internal/ma/webhooks/{hook}/deliveries",
            headers={"Authorization": "Bearer secret"},
            params={"tenant_id": "T", "limit": "0"},
        )
        assert bad_limit.status_code == 400

        oldest_id = await _delivery(async_engine, webhook_id=hook, created_at=oldest, delivered_at=oldest)
        middle_id = await _delivery(
            async_engine,
            webhook_id=hook,
            created_at=middle_at,
            status="failed",
            delivered_at=None,
            last_status_code=None,
            last_error="timeout",
        )
        newest_id = await _delivery(
            async_engine,
            webhook_id=hook,
            created_at=newest,
            attempts=2,
            delivered_at=newest,
        )
        await _delivery(async_engine, webhook_id=other_hook, created_at=later, delivered_at=later)
        await _delivery(
            async_engine,
            webhook_id=hook,
            tenant_id="OTHER",
            created_at=later,
            delivered_at=later,
        )

        headers = {"Authorization": "Bearer secret"}
        limited = await http.get(
            f"/internal/ma/webhooks/{hook}/deliveries",
            headers=headers,
            params={"tenant_id": "T", "limit": "1"},
        )
        assert limited.status_code == 200
        one = limited.json()["data"]
        assert [row["id"] for row in one] == [newest_id]
        assert set(one[0]) == {
            "id",
            "webhook_id",
            "event_id",
            "event_type",
            "status",
            "attempts",
            "next_attempt_at",
            "last_status_code",
            "last_error",
            "delivered_at",
            "created_at",
        }
        assert one[0]["attempts"] == 2
        assert one[0]["last_status_code"] == 204
        assert one[0]["event_type"] == "environment.created"
        assert one[0]["status"] == "succeeded"
        assert one[0]["created_at"].endswith("Z")
        assert one[0]["delivered_at"].endswith("Z")
        assert one[0]["next_attempt_at"].endswith("Z")
        assert "payload" not in one[0]
        assert "event_key" not in one[0]
        assert "secret-payload" not in limited.text

        listed = await http.get(
            f"/internal/ma/webhooks/{hook}/deliveries",
            headers=headers,
            params={"tenant_id": "T"},
        )
        rows = listed.json()["data"]
        assert [row["id"] for row in rows] == [newest_id, middle_id, oldest_id]
        assert rows[1]["delivered_at"] is None
        assert rows[1]["last_status_code"] is None
        assert rows[1]["last_error"] == "timeout"
        assert rows[1]["status"] == "failed"
        assert rows[1]["created_at"].endswith("Z")
        assert rows[1]["next_attempt_at"].endswith("Z")
    finally:
        await http.aclose()
        await store.close()
        sync_engine.dispose()


class _Plane:
    def __init__(self, hooks: list[dict[str, Any]]) -> None:
        self.hooks = hooks
        self.calls: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/internal/ma/webhooks" and request.method == "GET":
            return httpx.Response(200, json={"data": self.hooks})
        if request.method == "POST" and request.url.path.endswith("/auto-disable"):
            self.calls.append({"path": request.url.path, "body": json.loads(request.content)})
            return httpx.Response(200, json={"data": {"disabled": True}})
        return httpx.Response(404, json={"error": "missing"})


def _deliver_settings(**extra: Any) -> SimpleNamespace:
    values = {
        "webhook_allow_loopback": False,
        "webhook_block_private": False,
        "webhook_max_attempts": 6,
        "webhook_auto_disable_failures": 3,
        "webhook_auto_disable_hours": 0,
    }
    values.update(extra)
    return SimpleNamespace(**values)


async def _pending(engine: Any, hook: dict[str, Any], when: datetime, url_hint: str = "") -> None:
    event_id = new_ulid()
    async with engine.begin() as conn:
        await conn.execute(
            ma_webhook_deliveries.insert().values(
                id=new_ulid(),
                tenant_id="T",
                webhook_id=hook["id"],
                event_id=event_id,
                event_type="session.idle",
                event_key=f"session.idle:{event_id}:{url_hint}",
                payload={
                    "type": "event",
                    "id": event_id,
                    "created_at": "2026-10-26T01:00:00Z",
                    "data": {"type": "session.idle"},
                },
                status="pending",
                attempts=0,
                next_attempt_at=when,
                created_at=when,
                updated_at=when,
            )
        )


async def _already_failed(engine: Any, hook: dict[str, Any], when: datetime) -> None:
    event_id = new_ulid()
    async with engine.begin() as conn:
        await conn.execute(
            ma_webhook_deliveries.insert().values(
                id=new_ulid(),
                tenant_id="T",
                webhook_id=hook["id"],
                event_id=event_id,
                event_type="session.idle",
                event_key=f"session.idle:{event_id}",
                payload={
                    "type": "event",
                    "id": event_id,
                    "created_at": "2026-10-26T01:00:00Z",
                    "data": {"type": "session.idle"},
                },
                status="failed",
                attempts=1,
                next_attempt_at=when,
                last_error="http_400",
                created_at=when,
                updated_at=when,
            )
        )


def _calls_for(plane: _Plane, hook_id: str, reason: str | None = None) -> list[dict[str, Any]]:
    found = [call for call in plane.calls if call["path"].endswith(f"/webhooks/{hook_id}/auto-disable")]
    if reason is None:
        return found
    return [call for call in found if call["body"].get("reason") == reason]


@pytest.mark.asyncio
async def test_ac_s2_6_auto_disable(sqlite_urls: Any) -> None:
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    clock = Clock()
    recent = _hook(url="https://203.0.113.10/fail")
    old = _hook(url="https://203.0.113.10/fail")
    reset_at = clock.now + timedelta(hours=1)
    reset_hook = _hook(
        url="https://203.0.113.10/fail",
        failure_reset_at=reset_at.isoformat().replace("+00:00", "Z"),
    )
    streak = _hook(url="https://203.0.113.10/fail")
    gone = _hook(url="https://203.0.113.10/gone")
    hooks = [recent, old, reset_hook, streak, gone]
    plane = _Plane(hooks)

    def destination(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/ok"):
            return httpx.Response(204)
        if request.url.path.endswith("/gone"):
            return httpx.Response(410)
        return httpx.Response(400)

    admin = AdminConsoleClient("http://admin.test", "token", transport=httpx.MockTransport(plane.handle))
    cache = WebhookConfigCache(admin, ttl=0)
    http = httpx.AsyncClient(transport=httpx.MockTransport(destination), timeout=httpx.Timeout(10.0))
    span = WebhookDeliverer(
        engine=async_engine,
        cache=cache,
        settings=_deliver_settings(webhook_auto_disable_hours=24),
        http=http,
        clock=clock,
        client=admin,
    )
    immediate = WebhookDeliverer(
        engine=async_engine,
        cache=cache,
        settings=_deliver_settings(webhook_auto_disable_hours=0),
        http=http,
        clock=clock,
        client=admin,
    )
    try:
        for _ in range(3):
            await _pending(async_engine, recent, clock.now)
        await span.deliver_due()
        assert _calls_for(plane, recent["id"]) == []

        historic = clock.now - timedelta(hours=25)
        await _already_failed(async_engine, old, historic)
        await _already_failed(async_engine, old, historic)
        await _pending(async_engine, old, clock.now)
        await span.deliver_due()
        old_calls = _calls_for(plane, old["id"], "consecutive_failures")
        assert len(old_calls) == 1
        assert old_calls[0]["body"] == {"tenant_id": "T", "reason": "consecutive_failures"}
        assert old_calls[0]["path"] == f"/api/internal/ma/webhooks/{old['id']}/auto-disable"

        for _ in range(3):
            await _pending(async_engine, reset_hook, clock.now)
        await immediate.deliver_due()
        assert _calls_for(plane, reset_hook["id"]) == []
        clock.advance(2 * 3600)
        for _ in range(3):
            await _pending(async_engine, reset_hook, clock.now)
        await immediate.deliver_due()
        assert len(_calls_for(plane, reset_hook["id"], "consecutive_failures")) == 1

        for _ in range(2):
            await _pending(async_engine, streak, clock.now)
        await immediate.deliver_due()
        assert _calls_for(plane, streak["id"]) == []
        clock.advance(30)
        streak["url"] = "https://203.0.113.10/ok"
        await _pending(async_engine, streak, clock.now)
        await immediate.deliver_due()
        clock.advance(30)
        streak["url"] = "https://203.0.113.10/fail"
        await _pending(async_engine, streak, clock.now)
        await immediate.deliver_due()
        assert _calls_for(plane, streak["id"]) == []
        clock.advance(30)
        await _pending(async_engine, streak, clock.now)
        await immediate.deliver_due()
        clock.advance(30)
        await _pending(async_engine, streak, clock.now)
        await immediate.deliver_due()
        assert len(_calls_for(plane, streak["id"], "consecutive_failures")) == 1

        await _pending(async_engine, gone, clock.now)
        await immediate.deliver_due()
        gone_calls = _calls_for(plane, gone["id"])
        assert len(gone_calls) == 1
        assert gone_calls[0]["body"]["reason"] == "gone"
        assert gone_calls[0]["body"]["tenant_id"] == "T"
        assert cache._loaded_at is None
        gone_rows = _by(await _rows(async_engine), gone["id"])
        assert len(gone_rows) == 1
        assert gone_rows[0]["status"] == "failed"
        assert gone_rows[0]["last_error"] == "http_410"
    finally:
        await span.aclose()
        await immediate.aclose()
        await http.aclose()
        await admin.aclose()
        await async_engine.dispose()
        sync_engine.dispose()


@pytest.mark.skipif(
    not _catalog_groups_defined(),
    reason="MA_WEBHOOK_EVENT_GROUPS is not in core-api yet",
)
def test_webhook_catalog_parity() -> None:
    text = _CATALOG_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const MA_WEBHOOK_EVENT_GROUPS\s*=\s*\[(.*?)\]\s*as const",
        text,
        re.S,
    )
    assert match is not None
    found: list[str] = []
    for group in re.findall(r"types\s*:\s*\[([^\]]*)\]", match.group(1)):
        found.extend(re.findall(r"""["']([^"']+)["']""", group))
    assert set(found) == set(all_webhook_event_types())
    assert len(set(found)) == 29
