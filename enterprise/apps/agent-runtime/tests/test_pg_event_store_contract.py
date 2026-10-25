#!/usr/bin/env python3
"""Event store contract on SQLite and, when configured, PostgreSQL.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from sqlalchemy import func, select

from agenticx.managed.errors import MAError
from agenticx.managed.ids import new_ulid, parse_iso, utc_now_iso
from agenticx.managed.events.store import ThreadFilter
from agenticx.managed.protocol import SessionRecord, parse_server_event

from ma_agent_runtime.db import build_engines
from ma_agent_runtime.pg_event_store import PgEventStore, _insert_ignore
from ma_agent_runtime.tables import ma_session_usage, ma_sessions


def _record(session_id: str, tenant_id: str = "tenant-a", **overrides: Any) -> SessionRecord:
    now = utc_now_iso()
    payload: dict[str, Any] = {
        "id": session_id,
        "tenant_id": tenant_id,
        "agent_id": "agent-1",
        "agent_version": 2,
        "environment_id": "local",
        "created_by_user_id": "user-1",
        "source": "api",
        "status": "idle",
        "created_at": now,
        "updated_at": now,
    }
    payload.update(overrides)
    return SessionRecord.model_validate(payload)


async def test_append_assigns_contiguous_seq(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    await store.append_events("tenant-a", session_id, [{"type": "user.interrupt"}, {"type": "user.interrupt"}])
    await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}, {"type": "user.interrupt"}, {"type": "user.interrupt"}],
    )
    listed = await store.list_events("tenant-a", session_id)
    assert [item.seq for item in listed] == [1, 2, 3, 4, 5]
    assert await store.last_seq("tenant-a", session_id) == 5


async def test_concurrent_appends_unique_seq(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))

    async def append_one() -> int:
        stored = await store.append_events("tenant-a", session_id, [{"type": "user.interrupt"}])
        return stored[0].seq

    seqs = await asyncio.gather(*(append_one() for _ in range(20)))
    assert set(seqs) == set(range(1, 21))


async def test_list_events_after_seq_limit_types(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    batch = []
    for index in range(10):
        if index % 2 == 0:
            batch.append({"type": "agent.message", "content": [{"type": "text", "text": str(index)}]})
        else:
            batch.append({"type": "session.usage", "usage": {"input_tokens": index}})
    await store.append_events("tenant-a", session_id, batch)
    page = await store.list_events("tenant-a", session_id, after_seq=4, limit=3)
    assert [item.seq for item in page] == [5, 6, 7]
    usage_only = await store.list_events("tenant-a", session_id, types=["session.usage"])
    assert usage_only
    assert all(item.type == "session.usage" for item in usage_only)
    extra = [{"type": "session.usage", "usage": {"input_tokens": 1}} for _ in range(491)]
    await store.append_events("tenant-a", session_id, extra)
    capped = await store.list_events("tenant-a", session_id, limit=10_000)
    assert len(capped) == 500


async def test_tenant_isolation(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    assert await store.get_session("tenant-b", session_id) is None
    with pytest.raises(MAError) as caught:
        await store.append_events("tenant-b", session_id, [{"type": "user.interrupt"}])
    assert caught.value.code == "session_not_found"
    assert await store.list_events("tenant-b", session_id) == []


async def test_event_id_preserved_and_validated(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    event_id = new_ulid()
    stored = await store.append_events(
        "tenant-a",
        session_id,
        [{"id": event_id, "type": "user.interrupt"}],
    )
    assert stored[0].id == event_id
    with pytest.raises(MAError) as bad:
        await store.append_events("tenant-a", session_id, [{"id": "bad", "type": "user.interrupt"}])
    assert bad.value.code == "invalid_event_batch"
    assert bad.value.details["index"] == 0
    before = await store.last_seq("tenant-a", session_id)
    with pytest.raises(MAError) as duplicate:
        await store.append_events("tenant-a", session_id, [{"id": event_id, "type": "user.interrupt"}])
    assert duplicate.value.code == "invalid_event_batch"
    assert await store.last_seq("tenant-a", session_id) == before


async def test_append_is_atomic(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    before = await store.last_seq("tenant-a", session_id)
    with pytest.raises(MAError):
        await store.append_events(
            "tenant-a",
            session_id,
            [
                {"type": "user.interrupt"},
                {"type": "user.interrupt"},
                {"id": "bad", "type": "user.interrupt"},
            ],
        )
    assert await store.last_seq("tenant-a", session_id) == before
    assert await store.list_events("tenant-a", session_id) == []


async def test_stored_event_to_wire(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    stored = await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "agent.message", "content": [{"type": "text", "text": "hi"}]}],
    )
    wire = stored[0].to_wire()
    assert "tenant_id" not in wire
    parse_server_event(wire)


async def test_update_session_and_unsettled(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    updated = await store.update_session("tenant-a", session_id, {"status": "running"})
    assert updated.status == "running"
    unsettled = await store.list_unsettled_sessions()
    assert any(item.id == session_id for item in unsettled)
    action_id = new_ulid()
    await store.update_session(
        "tenant-a",
        session_id,
        {"status": "idle", "stop_reason": {"type": "requires_action", "event_ids": [action_id]}},
    )
    still = await store.list_unsettled_sessions()
    assert any(item.id == session_id for item in still)
    await store.update_session(
        "tenant-a",
        session_id,
        {"status": "idle", "stop_reason": {"type": "end_turn"}, "usage": {"input_tokens": 9}},
    )
    settled = await store.list_unsettled_sessions()
    assert all(item.id != session_id for item in settled)
    loaded = await store.get_session("tenant-a", session_id)
    assert loaded is not None
    assert loaded.usage.input_tokens == 9
    async with store._engine.connect() as conn:  # noqa: SLF001
        raw = (
            await conn.execute(select(ma_sessions.c.usage_totals).where(ma_sessions.c.id == session_id))
        ).scalar_one()
    assert isinstance(raw, dict)
    assert raw["input_tokens"] == 9
    with pytest.raises(ValueError):
        await store.update_session("tenant-a", session_id, {"nope": 1})


async def test_usage_row_per_model_request_end(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    stored = await store.append_events(
        "tenant-a",
        session_id,
        [
            {
                "type": "span.model_request_end",
                "model": "demo/reply",
                "model_usage": {"input_tokens": 3},
                "is_error": False,
            },
            {"type": "agent.message", "content": [{"type": "text", "text": "hi"}]},
            {
                "type": "span.model_request_end",
                "model": "demo/reply",
                "model_usage": {"input_tokens": 5},
            },
        ],
    )
    model_events = [item for item in stored if item.type == "span.model_request_end"]
    async with store._engine.connect() as conn:  # noqa: SLF001
        rows = (
            await conn.execute(
                select(ma_session_usage).where(ma_session_usage.c.session_id == session_id)
            )
        ).mappings().all()
    assert len(rows) == 2
    assert {int(row["event_seq"]) for row in rows} == {item.seq for item in model_events}
    assert {row["agent_id"] for row in rows} == {"agent-1"}
    assert {int(row["agent_version"]) for row in rows} == {2}
    assert {row["user_id"] for row in rows} == {"user-1"}
    duplicate_seq = model_events[0].seq
    async with store._engine.begin() as conn:  # noqa: SLF001
        stmt = _insert_ignore(conn.dialect.name, ma_session_usage, ("session_id", "event_seq"))
        await conn.execute(
            stmt,
            [
                {
                    "id": new_ulid(),
                    "tenant_id": "tenant-a",
                    "session_id": session_id,
                    "agent_id": "agent-1",
                    "agent_version": 2,
                    "user_id": "user-1",
                    "model": "demo/reply",
                    "input_tokens": 99,
                    "output_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "tool_calls": 0,
                    "runtime_ms": 0,
                    "is_error": False,
                    "event_seq": duplicate_seq,
                    "created_at": parse_iso(stored[0].created_at),
                }
            ],
        )
    async with store._engine.connect() as conn:  # noqa: SLF001
        count = (
            await conn.execute(
                select(func.count()).select_from(ma_session_usage).where(
                    ma_session_usage.c.session_id == session_id
                )
            )
        ).scalar_one()
    assert int(count) == 2


async def test_reopen_continues_seq(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}, {"type": "user.interrupt"}, {"type": "user.interrupt"}],
    )
    async_engine, sync_engine = build_engines(store.reopen_urls, pool_size=2)  # type: ignore[attr-defined]
    second = PgEventStore(async_engine)
    try:
        stored = await second.append_events("tenant-a", session_id, [{"type": "user.interrupt"}])
        assert stored[0].seq == 4
    finally:
        await second.close()
        sync_engine.dispose()


async def test_list_sessions_filters_by_creator(store: PgEventStore) -> None:
    first = new_ulid()
    second = new_ulid()
    third = new_ulid()
    await store.create_session(
        _record(
            first,
            created_by_user_id="user-a",
            agent_id="agent-1",
            created_at="2026-10-25T00:00:00.001Z",
            updated_at="2026-10-25T00:00:00.001Z",
        )
    )
    await store.create_session(
        _record(
            second,
            created_by_user_id="user-b",
            agent_id="agent-1",
            created_at="2026-10-25T00:00:00.002Z",
            updated_at="2026-10-25T00:00:00.002Z",
        )
    )
    await store.create_session(
        _record(
            third,
            created_by_user_id="user-a",
            agent_id="agent-2",
            created_at="2026-10-25T00:00:00.003Z",
            updated_at="2026-10-25T00:00:00.003Z",
        )
    )
    owned = await store.list_sessions("tenant-a", created_by_user_id="user-a")
    assert [item.id for item in owned] == [third, first]
    narrowed = await store.list_sessions("tenant-a", agent_id="agent-1", created_by_user_id="user-a")
    assert [item.id for item in narrowed] == [first]
    everyone = await store.list_sessions("tenant-a")
    assert [item.id for item in everyone] == [third, second, first]


async def test_list_events_thread_filter(store: PgEventStore) -> None:
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    await store.append_events(
        "tenant-a",
        session_id,
        [
            {"type": "user.message", "content": [{"type": "text", "text": "hi"}]},
            {
                "type": "agent.tool_use",
                "thread_id": "T1",
                "name": "file_write",
                "input": {},
                "evaluated_policy": "always_allow",
            },
            {"type": "session.thread_created", "thread_id": "T1", "agent": {"type": "self"}},
            {"type": "agent.message", "content": [{"type": "text", "text": "ok"}]},
            {
                "type": "agent.thread_message_received",
                "from_thread_id": "T1",
                "from_agent_name": "B",
                "content": [{"type": "text", "text": "back"}],
            },
            {
                "type": "agent.thread_message_sent",
                "thread_id": "T1",
                "to_agent_name": "coordinator",
                "content": [{"type": "text", "text": "back"}],
            },
        ],
    )
    session_rows = await store.list_events("tenant-a", session_id, thread_filter=ThreadFilter("session"))
    member_rows = await store.list_events("tenant-a", session_id, thread_filter=ThreadFilter("thread", "T1"))
    primary_rows = await store.list_events("tenant-a", session_id, thread_filter=ThreadFilter("thread", None))
    assert [item.seq for item in session_rows] == [1, 3, 4, 5]
    assert [item.seq for item in member_rows] == [2, 3, 6]
    assert [item.seq for item in primary_rows] == [1, 4, 5]
