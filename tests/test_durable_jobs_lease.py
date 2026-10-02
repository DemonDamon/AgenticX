#!/usr/bin/env python3
"""Durable job lease: claim exclusivity, cancel-wins, heartbeat abort.

Author: Damon Li
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import List, Optional

import pytest

from agenticx.runtime.durable_jobs.models import JobStatus
from agenticx.runtime.durable_jobs.store import DurableJobStore, LostLeaseError
from agenticx.runtime.durable_jobs.worker import DurableJobWorker


class FakeClock:
    """Injectable monotonic clock for lease expiry tests."""

    def __init__(self, start: float = 1_000.0) -> None:
        self._now = start

    def now(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


@pytest.fixture()
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture()
def store(tmp_path: Path, clock: FakeClock) -> DurableJobStore:
    return DurableJobStore(db_path=tmp_path / "durable_jobs.sqlite", clock=clock.now)


def test_create_queued(store: DurableJobStore) -> None:
    job = store.create(
        owner="meta",
        kind="automation",
        payload={"automation_task_id": "atask_1"},
    )
    assert job.id
    assert job.status == JobStatus.QUEUED
    assert job.lease_id is None
    assert job.attempts == 0
    loaded = store.get(job.id)
    assert loaded is not None
    assert loaded.status == JobStatus.QUEUED
    assert loaded.payload["automation_task_id"] == "atask_1"


def test_claim_exclusive(store: DurableJobStore) -> None:
    job = store.create(owner="o", kind="k", payload={})
    results: List[Optional[str]] = [None, None]
    barrier = threading.Barrier(2)

    def claim_one(idx: int) -> None:
        barrier.wait(timeout=5)
        claimed = store.claim(job.id, worker_id=f"w{idx}", lease_seconds=30.0)
        results[idx] = claimed.lease_id if claimed else None

    t0 = threading.Thread(target=claim_one, args=(0,))
    t1 = threading.Thread(target=claim_one, args=(1,))
    t0.start()
    t1.start()
    t0.join(timeout=5)
    t1.join(timeout=5)

    winners = [r for r in results if r is not None]
    assert len(winners) == 1
    refreshed = store.get(job.id)
    assert refreshed is not None
    assert refreshed.status == JobStatus.RUNNING
    assert refreshed.lease_id == winners[0]
    assert refreshed.attempts == 1


def test_expired_lease_reclaimable(
    store: DurableJobStore, clock: FakeClock
) -> None:
    job = store.create(owner="o", kind="k", payload={})
    first = store.claim(job.id, worker_id="w1", lease_seconds=10.0)
    assert first is not None
    clock.advance(11.0)
    second = store.claim(job.id, worker_id="w2", lease_seconds=10.0)
    assert second is not None
    assert second.lease_id != first.lease_id
    assert second.attempts == 2
    # Old worker teardown must not steal from new lease
    ok = store.compare_swap(
        job.id,
        expect_status=JobStatus.RUNNING,
        expect_lease_id=first.lease_id,
        patch_status=JobStatus.QUEUED,
        clear_lease=True,
    )
    assert ok is False
    refreshed = store.get(job.id)
    assert refreshed is not None
    assert refreshed.lease_id == second.lease_id
    assert refreshed.status == JobStatus.RUNNING


def test_heartbeat_lost_aborts(store: DurableJobStore, clock: FakeClock) -> None:
    job = store.create(owner="o", kind="k", payload={})
    claimed = store.claim(job.id, worker_id="w1", lease_seconds=10.0)
    assert claimed is not None
    aborted: List[str] = []

    def on_abort(job_id: str) -> None:
        aborted.append(job_id)

    # Simulate another worker taking over after expiry
    clock.advance(11.0)
    other = store.claim(job.id, worker_id="w2", lease_seconds=10.0)
    assert other is not None

    with pytest.raises(LostLeaseError):
        store.heartbeat(
            job.id,
            lease_id=claimed.lease_id,
            lease_seconds=10.0,
            on_lost_lease=on_abort,
        )
    assert aborted == [job.id]


def test_cancel_wins_over_teardown(store: DurableJobStore) -> None:
    job = store.create(owner="o", kind="k", payload={})
    claimed = store.claim(job.id, worker_id="w1", lease_seconds=30.0)
    assert claimed is not None
    lease = claimed.lease_id
    assert lease is not None

    ok = store.control(job.id, action="cancel")
    assert ok is True
    cancelled = store.get(job.id)
    assert cancelled is not None
    assert cancelled.status == JobStatus.CANCELLED
    assert cancelled.lease_id is None

    # In-flight handler teardown tries to requeue with old lease — must no-op
    requeued = store.compare_swap(
        job.id,
        expect_status=JobStatus.RUNNING,
        expect_lease_id=lease,
        patch_status=JobStatus.QUEUED,
        clear_lease=True,
    )
    assert requeued is False
    still = store.get(job.id)
    assert still is not None
    assert still.status == JobStatus.CANCELLED


def test_retry_only_failed(store: DurableJobStore) -> None:
    job = store.create(owner="o", kind="k", payload={})
    assert store.control(job.id, action="retry") is False

    claimed = store.claim(job.id, worker_id="w1", lease_seconds=30.0)
    assert claimed is not None
    store.fail(job.id, lease_id=claimed.lease_id, error="boom")
    failed = store.get(job.id)
    assert failed is not None
    assert failed.status == JobStatus.FAILED

    assert store.control(job.id, action="retry") is True
    retried = store.get(job.id)
    assert retried is not None
    assert retried.status == JobStatus.QUEUED
    assert retried.lease_id is None
    assert retried.error is None

    # succeeded / cancelled / running cannot retry
    again = store.claim(job.id, worker_id="w2", lease_seconds=30.0)
    assert again is not None
    store.complete(job.id, lease_id=again.lease_id)
    assert store.control(job.id, action="retry") is False


def test_worker_tick_runs_claimed_handler(
    tmp_path: Path, clock: FakeClock
) -> None:
    store = DurableJobStore(db_path=tmp_path / "dj.sqlite", clock=clock.now)
    job = store.create(owner="o", kind="echo", payload={"n": 1})
    ran: List[str] = []

    def handler(j) -> None:
        ran.append(j.id)
        store.complete(j.id, lease_id=j.lease_id)

    worker = DurableJobWorker(
        store=store,
        handlers={"echo": handler},
        max_concurrency=3,
        lease_seconds=30.0,
    )
    worker.tick()
    # Allow sync handler path to finish
    deadline = time.time() + 2.0
    while time.time() < deadline and not ran:
        time.sleep(0.01)
    worker.shutdown(wait=True)
    assert ran == [job.id]
    done = store.get(job.id)
    assert done is not None
    assert done.status == JobStatus.SUCCEEDED


def test_attach_durable_job_id_helper() -> None:
    from agenticx.runtime._automation_tasks_io import attach_durable_job_id

    task = {"id": "atask_x", "prompt": "hi"}
    out = attach_durable_job_id(task, "dj_abc")
    assert out["durable_job_id"] == "dj_abc"
    assert out is not task  # returns a shallow copy
    assert "durable_job_id" not in task
