#!/usr/bin/env python3
"""SQLite work-queue lease and claim tests.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from agenticx.managed.errors import MAError
from agenticx.managed.events.sqlite_store import SqliteEventStore
from agenticx.managed.host.work_queue import SqliteWorkQueue
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord

_DEVICE_A = "device-aaa"
_DEVICE_B = "device-bbb"


class _Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 25, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now = self.now + timedelta(seconds=seconds)


def _session(session_id: str) -> SessionRecord:
    now = utc_now_iso()
    return SessionRecord(
        id=session_id,
        tenant_id="dev",
        agent_id="demo",
        agent_version=1,
        environment_id="worker",
        source="api",
        status="idle",
        created_at=now,
        updated_at=now,
    )


async def _queue(tmp_path: Path, clock: _Clock | None = None) -> tuple[SqliteEventStore, SqliteWorkQueue, str]:
    store = SqliteEventStore(tmp_path / "ma.sqlite3")
    session_id = new_ulid()
    await store.create_session(_session(session_id))
    queue = SqliteWorkQueue(store, clock=clock)
    return store, queue, session_id


async def test_claim_next_is_exclusive(tmp_path: Path) -> None:
    store, queue, session_id = await _queue(tmp_path)
    created = queue.create(
        tenant_id="dev",
        session_id=session_id,
        environment_id="worker",
        inbox_after_seq=0,
    )
    assert created.status == "queued"
    assert created.attempts == 0
    first = queue.claim_next("dev", "worker", _DEVICE_A)
    second = queue.claim_next("dev", "worker", _DEVICE_B)
    assert second is None
    assert first is not None
    assert first.id == created.id
    assert first.status == "claimed"
    assert first.attempts == 1
    assert first.claimed_by_device == _DEVICE_A
    await store.close()


async def test_lease_rules(tmp_path: Path) -> None:
    clock = _Clock()
    store, queue, session_id = await _queue(tmp_path, clock)
    queue.create(
        tenant_id="dev",
        session_id=session_id,
        environment_id="worker",
        inbox_after_seq=5,
    )
    claimed = queue.claim_next("dev", "worker", _DEVICE_A)
    assert claimed is not None
    beating = queue.heartbeat("dev", claimed.id, _DEVICE_A)
    assert beating.status == "claimed"
    with pytest.raises(MAError) as other:
        queue.ack("dev", claimed.id, _DEVICE_B)
    assert other.value.code == "work_lease_lost"
    acked = queue.ack("dev", claimed.id, _DEVICE_A)
    assert acked.status == "running"
    with pytest.raises(MAError) as behind:
        queue.complete("dev", claimed.id, _DEVICE_A, 4)
    assert behind.value.code == "invalid_request"
    clock.advance(121)
    with pytest.raises(MAError) as expired:
        queue.heartbeat("dev", claimed.id, _DEVICE_A)
    assert expired.value.code == "work_lease_lost"
    await store.close()


async def test_expired_after_ttl_plus_grace(tmp_path: Path) -> None:
    clock = _Clock()
    store, queue, session_id = await _queue(tmp_path, clock)
    created = queue.create(
        tenant_id="dev",
        session_id=session_id,
        environment_id="worker",
        inbox_after_seq=0,
    )
    claimed = queue.claim_next("dev", "worker", _DEVICE_A)
    assert claimed is not None
    clock.advance(170)
    assert queue.expired() == []
    clock.advance(11)
    expired = queue.expired()
    assert [item.id for item in expired] == [created.id]
    assert queue.claim_next("dev", "worker", _DEVICE_B) is None
    await store.close()
