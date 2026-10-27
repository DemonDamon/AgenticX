#!/usr/bin/env python3
"""Event broadcaster and EventLog tests.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.managed.errors import MAError
from agenticx.managed.events.broadcast import EventBroadcaster, EventLog
from agenticx.managed.events.sqlite_store import SqliteEventStore
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord


def _record(session_id: str) -> SessionRecord:
    now = utc_now_iso()
    return SessionRecord(
        id=session_id,
        tenant_id="tenant-a",
        agent_id="agent-1",
        agent_version=1,
        source="api",
        status="idle",
        created_at=now,
        updated_at=now,
    )


def _stored(event_id: str, seq: int) -> StoredEvent:
    return StoredEvent(
        id=event_id,
        tenant_id="tenant-a",
        session_id="sess",
        seq=seq,
        type="session.status_running",
        payload={},
        created_at=utc_now_iso(),
    )


async def test_publish_fanout_and_overflow() -> None:
    broadcaster = EventBroadcaster()
    first = broadcaster.subscribe("sess")
    second = broadcaster.subscribe("sess")
    event = _stored(new_ulid(), 1)
    broadcaster.publish_events("sess", [event])
    left = first.queue.get_nowait()
    right = second.queue.get_nowait()
    assert left.kind == "event" and right.kind == "event"
    assert left.event is not None and right.event is not None
    assert left.event.id == event.id
    assert right.event.id == event.id

    small = EventBroadcaster(queue_maxsize=2)
    sub = small.subscribe("sess")
    small.publish_events("sess", [_stored(new_ulid(), index) for index in range(1, 4)])
    assert sub.overflowed is True
    assert small.subscriber_count("sess") == 0


async def test_close_session_sends_close() -> None:
    broadcaster = EventBroadcaster()
    sub = broadcaster.subscribe("sess")
    broadcaster.close_session("sess")
    item = sub.queue.get_nowait()
    assert item.kind == "close"


async def test_event_log_rejects_invalid_without_write(tmp_path: Path) -> None:
    store = SqliteEventStore(tmp_path / "events.sqlite")
    session_id = new_ulid()
    await store.create_session(_record(session_id))
    log = EventLog(store, EventBroadcaster())
    with pytest.raises(MAError) as caught:
        await log.append(
            "tenant-a",
            session_id,
            [
                {"type": "session.status_running"},
                {"type": "agent.message"},
            ],
        )
    assert caught.value.code == "invalid_event_batch"
    assert caught.value.details["index"] == 1
    assert await store.last_seq("tenant-a", session_id) == 0
    with pytest.raises(MAError) as unknown:
        await log.append("tenant-a", session_id, [{"type": "nope.event"}])
    assert unknown.value.code == "invalid_event_batch"
    assert await store.last_seq("tenant-a", session_id) == 0
    await store.close()
