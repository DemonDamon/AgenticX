#!/usr/bin/env python3
"""SQLite event store tests.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.managed.errors import MAError
from agenticx.managed.events.sqlite_store import SqliteEventStore
from agenticx.managed.events.store import ThreadFilter
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord, parse_server_event


def _record(session_id: str, tenant_id: str = "tenant-a") -> SessionRecord:
    now = utc_now_iso()
    return SessionRecord(
        id=session_id,
        tenant_id=tenant_id,
        agent_id="agent-1",
        agent_version=1,
        source="api",
        status="idle",
        created_at=now,
        updated_at=now,
    )


def _open(tmp_path: Path) -> SqliteEventStore:
    return SqliteEventStore(tmp_path / "events.sqlite")


async def test_append_assigns_contiguous_seq(tmp_path: Path) -> None:
    store = _open(tmp_path)
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    first = await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}, {"type": "user.interrupt"}],
    )
    second = await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}, {"type": "user.interrupt"}, {"type": "user.interrupt"}],
    )
    assert [item.seq for item in first] == [1, 2]
    assert [item.seq for item in second] == [3, 4, 5]
    assert await store.last_seq("tenant-a", session_id) == 5
    await store.close()


async def test_concurrent_appends_unique_seq(tmp_path: Path) -> None:
    store = _open(tmp_path)
    session_id = new_ulid()
    await store.create_session(_record(session_id))

    async def append_one() -> int:
        stored = await store.append_events(
            "tenant-a",
            session_id,
            [{"type": "user.interrupt"}],
        )
        return stored[0].seq

    seqs = await asyncio.gather(*(append_one() for _ in range(20)))
    assert set(seqs) == set(range(1, 21))
    await store.close()


async def test_list_events_after_seq_limit_types(tmp_path: Path) -> None:
    store = _open(tmp_path)
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    batch = []
    for index in range(10):
        if index % 2 == 0:
            batch.append(
                {
                    "type": "agent.message",
                    "content": [{"type": "text", "text": str(index)}],
                }
            )
        else:
            batch.append({"type": "session.usage", "usage": {"input_tokens": index}})
    await store.append_events("tenant-a", session_id, batch)
    page = await store.list_events("tenant-a", session_id, after_seq=4, limit=3)
    assert [item.seq for item in page] == [5, 6, 7]
    usage_only = await store.list_events(
        "tenant-a",
        session_id,
        types=["session.usage"],
    )
    assert usage_only
    assert all(item.type == "session.usage" for item in usage_only)
    extra = [{"type": "session.usage", "usage": {"input_tokens": 1}} for _ in range(491)]
    await store.append_events("tenant-a", session_id, extra)
    capped = await store.list_events("tenant-a", session_id, limit=10_000)
    assert len(capped) == 500
    await store.close()


async def test_reopen_continues_seq(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite"
    store = SqliteEventStore(path)
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}, {"type": "user.interrupt"}, {"type": "user.interrupt"}],
    )
    await store.close()
    reopened = SqliteEventStore(path)
    stored = await reopened.append_events(
        "tenant-a",
        session_id,
        [{"type": "user.interrupt"}],
    )
    assert stored[0].seq == 4
    listed = await reopened.list_events("tenant-a", session_id)
    assert len(listed) == 4
    await reopened.close()


async def test_tenant_isolation(tmp_path: Path) -> None:
    store = _open(tmp_path)
    session_id = new_ulid()
    await store.create_session(_record(session_id, "tenant-a"))
    assert await store.get_session("tenant-b", session_id) is None
    with pytest.raises(MAError) as caught:
        await store.append_events("tenant-b", session_id, [{"type": "user.interrupt"}])
    assert caught.value.code == "session_not_found"
    assert await store.list_events("tenant-b", session_id) == []
    await store.close()


async def test_event_id_preserved_and_validated(tmp_path: Path) -> None:
    store = _open(tmp_path)
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
        await store.append_events(
            "tenant-a",
            session_id,
            [{"id": "bad", "type": "user.interrupt"}],
        )
    assert bad.value.code == "invalid_event_batch"
    assert bad.value.details["index"] == 0
    before = await store.last_seq("tenant-a", session_id)
    with pytest.raises(MAError) as duplicate:
        await store.append_events(
            "tenant-a",
            session_id,
            [{"id": event_id, "type": "user.interrupt"}],
        )
    assert duplicate.value.code == "invalid_event_batch"
    assert await store.last_seq("tenant-a", session_id) == before
    await store.close()


async def test_append_is_atomic(tmp_path: Path) -> None:
    store = _open(tmp_path)
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
    await store.close()


async def test_stored_event_to_wire(tmp_path: Path) -> None:
    store = _open(tmp_path)
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    stored = await store.append_events(
        "tenant-a",
        session_id,
        [{"type": "agent.message", "content": [{"type": "text", "text": "hi"}]}],
    )
    wire = stored[0].to_wire()
    assert wire["id"] == stored[0].id
    assert wire["session_id"] == session_id
    assert wire["seq"] == 1
    assert wire["type"] == "agent.message"
    assert "created_at" in wire
    assert wire["content"] == [{"type": "text", "text": "hi"}]
    assert "tenant_id" not in wire
    assert "processed_at" not in wire
    parse_server_event(wire)
    await store.close()


async def test_update_session_and_unsettled(tmp_path: Path) -> None:
    store = _open(tmp_path)
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
        {
            "status": "idle",
            "stop_reason": {"type": "requires_action", "event_ids": [action_id]},
        },
    )
    still = await store.list_unsettled_sessions()
    assert any(item.id == session_id for item in still)
    await store.update_session(
        "tenant-a",
        session_id,
        {"status": "idle", "stop_reason": {"type": "end_turn"}},
    )
    settled = await store.list_unsettled_sessions()
    assert all(item.id != session_id for item in settled)
    with pytest.raises(ValueError):
        await store.update_session("tenant-a", session_id, {"nope": 1})
    await store.close()


async def test_list_sessions_filters_by_creator(tmp_path: Path) -> None:
    store = _open(tmp_path)

    def record(session_id: str, *, user: str, created_at: str, agent_id: str) -> SessionRecord:
        return SessionRecord(
            id=session_id,
            tenant_id="tenant-a",
            agent_id=agent_id,
            agent_version=1,
            source="api",
            status="idle",
            created_by_user_id=user,
            created_at=created_at,
            updated_at=created_at,
        )

    first = new_ulid()
    second = new_ulid()
    third = new_ulid()
    await store.create_session(
        record(first, user="user-a", created_at="2026-10-25T00:00:00.001Z", agent_id="agent-1")
    )
    await store.create_session(
        record(second, user="user-b", created_at="2026-10-25T00:00:00.002Z", agent_id="agent-1")
    )
    await store.create_session(
        record(third, user="user-a", created_at="2026-10-25T00:00:00.003Z", agent_id="agent-2")
    )
    owned = await store.list_sessions("tenant-a", created_by_user_id="user-a")
    assert [item.id for item in owned] == [third, first]
    narrowed = await store.list_sessions(
        "tenant-a",
        agent_id="agent-1",
        created_by_user_id="user-a",
    )
    assert [item.id for item in narrowed] == [first]
    everyone = await store.list_sessions("tenant-a")
    assert [item.id for item in everyone] == [third, second, first]
    await store.close()


async def test_list_events_thread_filter(tmp_path: Path) -> None:
    store = _open(tmp_path)
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
    member_rows = await store.list_events(
        "tenant-a", session_id, thread_filter=ThreadFilter("thread", "T1")
    )
    primary_rows = await store.list_events(
        "tenant-a", session_id, thread_filter=ThreadFilter("thread", None)
    )
    assert [item.seq for item in session_rows] == [1, 3, 4, 5]
    assert [item.seq for item in member_rows] == [2, 3, 6]
    assert [item.seq for item in primary_rows] == [1, 4, 5]
    await store.close()
