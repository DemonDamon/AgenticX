#!/usr/bin/env python3
"""Work queue lease contract on SQLite and, when configured, PostgreSQL.

Author: Damon Li
"""

from __future__ import annotations

import time

import pytest
from sqlalchemy import select

from agenticx.managed.errors import MAError

from ma_agent_runtime.pg_work_queue import PgWorkQueue
from ma_agent_runtime.tables import ma_work_items

_DEVICE_A = "device-aaa"
_DEVICE_B = "device-bbb"


def _create(queue: PgWorkQueue, *, inbox_after_seq: int = 0) -> str:
    created = queue.create(
        tenant_id="dev",
        session_id="session-1",
        environment_id="worker",
        inbox_after_seq=inbox_after_seq,
    )
    return created.id


def test_claim_next_is_exclusive(work_queue: PgWorkQueue) -> None:
    created_id = _create(work_queue)
    created = work_queue.get("dev", created_id)
    assert created is not None
    assert created.status == "queued"
    assert created.attempts == 0
    first = work_queue.claim_next("dev", "worker", _DEVICE_A)
    second = work_queue.claim_next("dev", "worker", _DEVICE_B)
    assert second is None
    assert first is not None
    assert first.id == created_id
    assert first.status == "claimed"
    assert first.attempts == 1
    assert first.claimed_by_device == _DEVICE_A
    with work_queue._engine.connect() as conn:  # noqa: SLF001
        claimed_at = conn.execute(
            select(ma_work_items.c.claimed_at).where(ma_work_items.c.id == created_id)
        ).scalar_one()
    assert claimed_at is not None


def test_lease_rules(work_queue: PgWorkQueue) -> None:
    created_id = _create(work_queue, inbox_after_seq=5)
    claimed = work_queue.claim_next("dev", "worker", _DEVICE_A)
    assert claimed is not None
    beating = work_queue.heartbeat("dev", claimed.id, _DEVICE_A)
    assert beating.status == "claimed"
    with pytest.raises(MAError) as other:
        work_queue.ack("dev", claimed.id, _DEVICE_B)
    assert other.value.code == "work_lease_lost"
    acked = work_queue.ack("dev", claimed.id, _DEVICE_A)
    assert acked.status == "running"
    with pytest.raises(MAError) as behind:
        work_queue.complete("dev", claimed.id, _DEVICE_A, 4)
    assert behind.value.code == "invalid_request"
    work_queue.clock.advance(121)  # type: ignore[attr-defined]
    with pytest.raises(MAError) as expired:
        work_queue.heartbeat("dev", claimed.id, _DEVICE_A)
    assert expired.value.code == "work_lease_lost"
    assert created_id == claimed.id


def test_expired_after_ttl_plus_grace(work_queue: PgWorkQueue) -> None:
    created_id = _create(work_queue)
    claimed = work_queue.claim_next("dev", "worker", _DEVICE_A)
    assert claimed is not None
    work_queue.clock.advance(170)  # type: ignore[attr-defined]
    assert work_queue.expired() == []
    work_queue.clock.advance(11)  # type: ignore[attr-defined]
    expired = work_queue.expired()
    assert [item.id for item in expired] == [created_id]
    assert work_queue.claim_next("dev", "worker", _DEVICE_B) is None


def test_finish_sets_completed_at_and_never_reclaimed(work_queue: PgWorkQueue) -> None:
    created_id = _create(work_queue)
    claimed = work_queue.claim_next("dev", "worker", _DEVICE_A)
    assert claimed is not None
    finished = work_queue.finish(
        "dev",
        claimed.id,
        status="stopped",
        error="stopped by test",
        consumed_through_seq=0,
    )
    assert finished.status == "stopped"
    assert work_queue.claim_next("dev", "worker", _DEVICE_B) is None
    with work_queue._engine.connect() as conn:  # noqa: SLF001
        completed_at = conn.execute(
            select(ma_work_items.c.completed_at).where(ma_work_items.c.id == created_id)
        ).scalar_one()
    assert completed_at is not None


def test_inbox_columns_roundtrip(work_queue: PgWorkQueue) -> None:
    created = work_queue.create(
        tenant_id="dev",
        session_id="session-1",
        environment_id="worker",
        inbox_after_seq=7,
    )
    loaded = work_queue.get("dev", created.id)
    assert loaded is not None
    assert loaded.inbox_after_seq == 7
    work_queue.claim_next("dev", "worker", _DEVICE_A)
    work_queue.ack("dev", created.id, _DEVICE_A)
    done = work_queue.complete("dev", created.id, _DEVICE_A, 9)
    assert done.consumed_through_seq == 9


async def test_wait_for_work_returns_within_slice(work_queue: PgWorkQueue) -> None:
    started = time.monotonic()
    await work_queue.wait_for_work("worker", 10)
    assert time.monotonic() - started < 2.5
