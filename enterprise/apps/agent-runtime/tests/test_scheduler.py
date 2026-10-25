#!/usr/bin/env python3
"""Schedule ticker planning, firing, and terminal completion.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select

from agenticx.managed.errors import INVALID_REQUEST, MAError
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.config import Principal
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord

from conftest import Clock
from fakes import FakeAdminConsole
from ma_agent_runtime.control_plane import AdminConsoleClient
from ma_agent_runtime.cron import next_fire, parse_cron
from ma_agent_runtime.db import build_engines
from ma_agent_runtime.scheduler import ScheduleTicker
from ma_agent_runtime.tables import ma_schedule_runs


class FakeStore:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], SessionRecord] = {}

    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        return self.sessions.get((tenant_id, session_id))


class FakeSessions:
    def __init__(self, fail: Exception | None = None) -> None:
        self.fail = fail
        self.calls: list[tuple[Principal, Any]] = []
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.store = FakeStore()

    async def create_session(self, principal: Principal, req: Any) -> SessionRecord:
        self.calls.append((principal, req))
        if self.fail is not None:
            raise self.fail
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


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


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


async def _rows(engine: Any) -> list[dict[str, Any]]:
    async with engine.connect() as conn:
        found = (await conn.execute(select(ma_schedule_runs))).mappings().all()
    return [dict(row) for row in found]


async def _insert(engine: Any, **values: Any) -> str:
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


@pytest.fixture
async def engine(sqlite_urls: Any):
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=4)
    try:
        yield async_engine
    finally:
        await async_engine.dispose()
        sync_engine.dispose()


def _ticker(engine: Any, fake: FakeAdminConsole, sessions: FakeSessions, clock: Clock, **settings: Any) -> tuple[ScheduleTicker, AdminConsoleClient]:
    client = AdminConsoleClient("http://admin.test", "token", transport=fake.transport)
    ticker = ScheduleTicker(
        engine=engine,
        client=client,
        service=sessions,
        settings=SimpleNamespace(
            scheduler_tick_seconds=15,
            schedule_run_timeout_seconds=settings.get("timeout", 3600),
        ),
        clock=clock,
    )
    return ticker, client


@pytest.mark.asyncio
async def test_plans_next_slot(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-23T02:00:00Z")
    schedule = _schedule()
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = await _rows(engine)
        assert len(rows) == 1
        assert rows[0]["status"] == "scheduled"
        expect = next_fire(parse_cron(schedule["cron"]), schedule["timezone"], clock.now)
        stored = rows[0]["scheduled_for"]
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        assert stored.astimezone(timezone.utc) == expect
        assert sessions.calls == []
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_fires_due_run_once(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-23T02:00:00Z")
    schedule = _schedule()
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        planned = (await _rows(engine))[0]["scheduled_for"]
        if planned.tzinfo is None:
            planned = planned.replace(tzinfo=timezone.utc)
        clock.now = planned.astimezone(timezone.utc)
        await ticker.tick()
        assert len(sessions.calls) == 1
        _principal, req = sessions.calls[0]
        assert req.source == "schedule"
        assert req.agent_version is None
        rows = await _rows(engine)
        running = [row for row in rows if row["status"] == "running"]
        upcoming = [row for row in rows if row["status"] == "scheduled"]
        assert len(running) == 1
        assert running[0]["session_id"]
        assert len(upcoming) == 1
        text = sessions.events[0][1]["events"][0]["content"][0]["text"]
        assert text == "现在 2026-10-26 09:00 日报"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_two_tickers_fire_once(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T01:00:00Z")
    schedule = _schedule()
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    await _insert(
        engine,
        schedule_id=schedule["id"],
        scheduled_for=clock.now,
        now=clock.now,
        schedule_revision=1,
    )
    first, client_a = _ticker(engine, fake, sessions, clock)
    second, client_b = _ticker(engine, fake, sessions, clock)
    try:
        await asyncio.gather(first.tick(), second.tick())
        assert len(sessions.calls) == 1
    finally:
        await client_a.aclose()
        await client_b.aclose()


@pytest.mark.asyncio
async def test_missed_run_is_skipped(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T01:10:00Z")
    schedule = _schedule(misfire_grace_seconds=300)
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    await _insert(
        engine,
        schedule_id=schedule["id"],
        scheduled_for=clock.now - timedelta(seconds=600),
        now=clock.now,
    )
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = await _rows(engine)
        missed = [row for row in rows if row["skip_reason"] == "missed"]
        upcoming = [row for row in rows if row["status"] == "scheduled"]
        assert len(missed) == 1
        assert missed[0]["status"] == "skipped"
        assert upcoming
        assert sessions.calls == []
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_overlap_is_skipped(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T01:00:00Z")
    schedule = _schedule()
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    await _insert(
        engine,
        schedule_id=schedule["id"],
        scheduled_for=clock.now - timedelta(hours=24),
        status="running",
        started_at=clock.now,
        now=clock.now,
        session_id=new_ulid(),
    )
    await _insert(engine, schedule_id=schedule["id"], scheduled_for=clock.now, now=clock.now)
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = await _rows(engine)
        overlap = [row for row in rows if row["skip_reason"] == "overlap"]
        assert len(overlap) == 1
        assert sessions.calls == []
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_revision_replaces_planned_row(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-23T02:00:00Z")
    schedule = _schedule(revision=2)
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    old = await _insert(
        engine,
        schedule_id=schedule["id"],
        scheduled_for=clock.now + timedelta(days=1),
        schedule_revision=1,
        now=clock.now,
    )
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = {row["id"]: row for row in await _rows(engine)}
        assert rows[old]["status"] == "skipped"
        assert rows[old]["skip_reason"] == "revised"
        fresh = [row for row in rows.values() if row["status"] == "scheduled"]
        assert len(fresh) == 1
        assert fresh[0]["schedule_revision"] == 2
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_disabled_and_deleted(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-23T02:00:00Z")
    disabled_id = new_ulid()
    deleted_id = new_ulid()
    fake = FakeAdminConsole()
    fake.schedules = []
    fake.disabled_ids = [disabled_id]
    sessions = FakeSessions()
    disabled = await _insert(engine, schedule_id=disabled_id, scheduled_for=clock.now + timedelta(days=1), now=clock.now)
    deleted = await _insert(engine, schedule_id=deleted_id, scheduled_for=clock.now + timedelta(days=1), now=clock.now)
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = {row["id"]: row for row in await _rows(engine)}
        assert rows[disabled]["status"] == "skipped" and rows[disabled]["skip_reason"] == "disabled"
        assert rows[deleted]["status"] == "skipped" and rows[deleted]["skip_reason"] == "deleted"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_manual_request_fires_once(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-24T02:00:00Z")
    schedule = _schedule(manual_run_requested_at=clock.now.isoformat().replace("+00:00", "Z"))
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions()
    planned = await _insert(
        engine,
        schedule_id=schedule["id"],
        scheduled_for=_utc("2026-10-26T01:00:00Z"),
        now=clock.now,
    )
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        await ticker.tick()
        assert len(sessions.calls) == 1
        rows = await _rows(engine)
        manual = [row for row in rows if row["trigger"] == "manual"]
        assert len(manual) == 1
        assert manual[0]["status"] == "running"
        kept = [row for row in rows if row["id"] == planned]
        assert kept[0]["status"] == "scheduled" and kept[0]["trigger"] == "schedule"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_terminal_marks_run(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T01:00:00Z")
    fake = FakeAdminConsole()
    sessions = FakeSessions()
    ticker, client = _ticker(engine, fake, sessions, clock)

    async def running(stop: str) -> str:
        session_id = new_ulid()
        record = SessionRecord(
            id=session_id,
            tenant_id="T",
            agent_id="agent-1",
            agent_version=1,
            created_by_user_id="user-1",
            source="schedule",
            status="running",
            created_at=utc_now_iso(),
            updated_at=utc_now_iso(),
        )
        sessions.store.sessions[("T", session_id)] = record
        return await _insert(
            engine,
            schedule_id=new_ulid(),
            session_id=session_id,
            status="running",
            started_at=clock.now,
            scheduled_for=clock.now,
            now=clock.now,
        )

    try:
        end_turn = await running("end_turn")
        exhausted = await running("retries_exhausted")
        needs_action = await running("requires_action")
        by_session = {row["session_id"]: row for row in await _rows(engine)}
        await ticker.on_terminal(
            "T",
            next(sid for sid, row in by_session.items() if row["id"] == end_turn),
            StoredEvent("e1", "T", "s", 1, "session.status_idle", {"stop_reason": {"type": "end_turn"}}, "t"),
        )
        await ticker.on_terminal(
            "T",
            next(sid for sid, row in by_session.items() if row["id"] == exhausted),
            StoredEvent("e2", "T", "s", 1, "session.status_idle", {"stop_reason": {"type": "retries_exhausted"}}, "t"),
        )
        action_session = next(sid for sid, row in by_session.items() if row["id"] == needs_action)
        await ticker.on_terminal(
            "T",
            action_session,
            StoredEvent("e3", "T", "s", 1, "session.status_idle", {"stop_reason": {"type": "requires_action"}}, "t"),
        )
        rows = {row["id"]: row for row in await _rows(engine)}
        assert rows[end_turn]["status"] == "succeeded"
        assert rows[exhausted]["status"] == "failed"
        assert rows[exhausted]["error"] == "retries_exhausted"
        assert rows[needs_action]["status"] == "failed"
        assert rows[needs_action]["error"] == "requires_action"
        assert sessions.events[-1][0] == action_session
        assert sessions.events[-1][1]["events"][0]["type"] == "user.interrupt"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_run_timeout_interrupts(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T03:00:00Z")
    fake = FakeAdminConsole()
    sessions = FakeSessions()
    session_id = new_ulid()
    sessions.store.sessions[("T", session_id)] = SessionRecord(
        id=session_id,
        tenant_id="T",
        agent_id="agent-1",
        agent_version=1,
        created_by_user_id="user-1",
        source="schedule",
        status="running",
        created_at=utc_now_iso(),
        updated_at=utc_now_iso(),
    )
    run_id = await _insert(
        engine,
        schedule_id=new_ulid(),
        session_id=session_id,
        status="running",
        started_at=clock.now - timedelta(seconds=3601),
        scheduled_for=clock.now - timedelta(seconds=3601),
        now=clock.now,
    )
    ticker, client = _ticker(engine, fake, sessions, clock, timeout=3600)
    try:
        await ticker.tick()
        rows = {row["id"]: row for row in await _rows(engine)}
        assert rows[run_id]["status"] == "failed"
        assert rows[run_id]["error"] == "timeout"
        assert sessions.events[0][1]["events"][0]["type"] == "user.interrupt"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_host_rejection_marks_failed(engine: Any) -> None:
    clock = Clock()
    clock.now = _utc("2026-10-26T01:00:00Z")
    schedule = _schedule(vault_ids=["01ARZ3NDEKTSV4RRFFQ69G5FAV"])
    fake = FakeAdminConsole()
    fake.schedules = [schedule]
    sessions = FakeSessions(fail=MAError(INVALID_REQUEST, "vault_ids are not supported by this host yet"))
    await _insert(engine, schedule_id=schedule["id"], scheduled_for=clock.now, now=clock.now)
    ticker, client = _ticker(engine, fake, sessions, clock)
    try:
        await ticker.tick()
        rows = await _rows(engine)
        failed = [row for row in rows if row["status"] == "failed"]
        upcoming = [row for row in rows if row["status"] == "scheduled"]
        assert len(failed) == 1
        assert failed[0]["error"] == "invalid_request: vault_ids are not supported by this host yet"
        assert upcoming
    finally:
        await client.aclose()
