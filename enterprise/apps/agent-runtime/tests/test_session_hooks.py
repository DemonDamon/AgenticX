#!/usr/bin/env python3
"""Terminal listeners stay off the append path.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord

from conftest import Clock
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.db import build_engines, split_database_url
from ma_agent_runtime.pg_event_store import PgEventStore
from ma_agent_runtime.session_hooks import HookedPgEventStore
from ma_agent_runtime.tables import metadata


def _session(session_id: str) -> SessionRecord:
    now = utc_now_iso()
    return SessionRecord(
        id=session_id,
        tenant_id="T",
        agent_id="A",
        agent_version=1,
        source="api",
        status="idle",
        created_by_user_id="U",
        created_at=now,
        updated_at=now,
    )


async def _open(tmp_path: Path, name: str, clock: Clock) -> tuple[HookedPgEventStore, object]:
    urls = split_database_url(f"sqlite:///{tmp_path / name}")
    sync_engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(sync_engine)
    sync_engine.dispose()
    async_engine, sync_runtime = build_engines(urls, pool_size=2)
    return HookedPgEventStore(async_engine, clock=clock), sync_runtime


@pytest.mark.asyncio
async def test_listener_runs_after_commit(tmp_path: Path) -> None:
    clock = Clock()
    store, sync_engine = await _open(tmp_path, "hook.db", clock)
    seen: list[StoredEvent] = []

    async def listener(_tenant: str, _session: str, event: StoredEvent) -> None:
        seen.append(event)

    store.add_terminal_listener(listener)
    session_id = new_ulid()
    await store.create_session(_session(session_id))
    try:
        stored = await store.append_events(
            "T",
            session_id,
            [
                {"type": "agent.message", "content": [{"type": "text", "text": "hi"}]},
                {"type": "session.status_idle", "stop_reason": {"type": "end_turn"}},
            ],
        )
        await store.drain()
        assert len(seen) == 1
        assert seen[0].type == "session.status_idle"
        assert seen[0].id == stored[1].id
    finally:
        await store.close()
        sync_engine.dispose()


@pytest.mark.asyncio
async def test_listener_not_awaited_inline(tmp_path: Path) -> None:
    clock = Clock()
    store, sync_engine = await _open(tmp_path, "slow.db", clock)
    started = asyncio.Event()

    async def listener(_tenant: str, _session: str, _event: StoredEvent) -> None:
        started.set()
        await asyncio.sleep(0.2)

    store.add_terminal_listener(listener)
    session_id = new_ulid()
    await store.create_session(_session(session_id))
    try:
        started_at = asyncio.get_running_loop().time()
        await store.append_events(
            "T",
            session_id,
            [{"type": "session.status_idle", "stop_reason": {"type": "end_turn"}}],
        )
        elapsed = asyncio.get_running_loop().time() - started_at
        assert elapsed < 0.1
        await store.drain()
        assert started.is_set()
    finally:
        await store.close()
        sync_engine.dispose()


@pytest.mark.asyncio
async def test_listener_errors_are_swallowed(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    store, sync_engine = await _open(tmp_path, "err.db", clock)

    async def listener(_tenant: str, _session: str, _event: StoredEvent) -> None:
        raise RuntimeError("boom")

    store.add_terminal_listener(listener)
    session_id = new_ulid()
    await store.create_session(_session(session_id))
    try:
        with caplog.at_level(logging.ERROR):
            stored = await store.append_events(
                "T",
                session_id,
                [{"type": "session.status_terminated"}],
            )
            await store.drain()
        assert len(stored) == 1
        assert "terminal listener failed" in caplog.text
    finally:
        await store.close()
        sync_engine.dispose()


@pytest.mark.asyncio
async def test_no_listeners_match_plain_store(tmp_path: Path) -> None:
    clock = Clock()
    hooked, hooked_sync = await _open(tmp_path, "hooked.db", clock)
    urls = split_database_url(f"sqlite:///{tmp_path / 'plain.db'}")
    sync_engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(sync_engine)
    async_engine, plain_sync = build_engines(urls, pool_size=2)
    plain = PgEventStore(async_engine, clock=clock)
    session_id = new_ulid()
    events = [{"id": new_ulid(), "type": "agent.message", "content": [{"type": "text", "text": "same"}]}]
    try:
        await hooked.create_session(_session(session_id))
        await plain.create_session(_session(session_id))
        left = await hooked.append_events("T", session_id, events)
        right = await plain.append_events("T", session_id, events)
        assert [item.to_wire() for item in left] == [item.to_wire() for item in right]
        assert hooked._listeners == []
    finally:
        await hooked.close()
        await plain.close()
        hooked_sync.dispose()
        plain_sync.dispose()
        sync_engine.dispose()


@pytest.mark.asyncio
async def test_build_app_without_flags_has_no_listeners(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
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
        gateway_token="agx-pat-gw", # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
        scheduler_enabled=False,
        webhooks_enabled=False,
    )
    app = build_app(settings, scrub_env=False)
    try:
        assert app.state.ma.store._listeners == []
        assert "schedule_ticker" not in app.state.ma.extras
        assert "webhook_deliverer" not in app.state.ma.extras
    finally:
        await app.state.ma.shutdown()
