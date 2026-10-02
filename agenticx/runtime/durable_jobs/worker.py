#!/usr/bin/env python3
"""Durable job worker: poll claimable jobs and run handlers under a lease.

Author: Damon Li
"""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Any, Callable, Dict, Optional

from agenticx.runtime.durable_jobs.models import DurableJob
from agenticx.runtime.durable_jobs.store import DurableJobStore, LostLeaseError

logger = logging.getLogger(__name__)

JobHandler = Callable[[DurableJob], Any]


class DurableJobWorker:
    """Polls DurableJobStore and runs handlers with lease heartbeat semantics.

    In-process active map only — cross-process exclusivity comes from the store CAS.
    """

    def __init__(
        self,
        store: DurableJobStore,
        handlers: Dict[str, JobHandler],
        *,
        max_concurrency: int = 3,
        lease_seconds: float = 30.0,
        worker_id: Optional[str] = None,
    ) -> None:
        self._store = store
        self._handlers = dict(handlers)
        self._max_concurrency = max(1, int(max_concurrency))
        self._lease_seconds = float(lease_seconds)
        self._worker_id = worker_id or f"worker_{uuid.uuid4().hex[:8]}"
        self._active: Dict[str, threading.Thread] = {}
        self._abort_flags: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._stopped = threading.Event()

    @property
    def worker_id(self) -> str:
        return self._worker_id

    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._active)

    def request_abort(self, job_id: str) -> None:
        ev = self._abort_flags.get(job_id)
        if ev is not None:
            ev.set()

    def tick(self) -> int:
        """Claim up to available concurrency slots. Returns number newly started."""
        if self._stopped.is_set():
            return 0
        started = 0
        with self._lock:
            # Prune finished threads
            done = [jid for jid, t in self._active.items() if not t.is_alive()]
            for jid in done:
                self._active.pop(jid, None)
                self._abort_flags.pop(jid, None)
            slots = self._max_concurrency - len(self._active)
        if slots <= 0:
            return 0

        candidates = self._store.list_claimable(limit=slots * 2)
        for job in candidates:
            if started >= slots:
                break
            with self._lock:
                if job.id in self._active:
                    continue
                if len(self._active) >= self._max_concurrency:
                    break
            claimed = self._store.claim(
                job.id,
                worker_id=self._worker_id,
                lease_seconds=self._lease_seconds,
            )
            if claimed is None:
                continue
            handler = self._handlers.get(claimed.kind)
            if handler is None:
                self._store.fail(
                    claimed.id,
                    lease_id=claimed.lease_id or "",
                    error=f"no handler for kind={claimed.kind!r}",
                )
                continue
            abort_ev = threading.Event()
            thread = threading.Thread(
                target=self._run_job,
                args=(claimed, handler, abort_ev),
                name=f"durable-{claimed.id}",
                daemon=True,
            )
            with self._lock:
                self._abort_flags[claimed.id] = abort_ev
                self._active[claimed.id] = thread
            thread.start()
            started += 1
        return started

    def _run_job(
        self,
        job: DurableJob,
        handler: JobHandler,
        abort_ev: threading.Event,
    ) -> None:
        lease_id = job.lease_id
        assert lease_id is not None

        def on_lost(jid: str) -> None:
            abort_ev.set()
            logger.info("lost lease on %s; aborting handler", jid)

        try:
            # Heartbeat once before work (detect cancel / stolen lease early)
            try:
                self._store.heartbeat(
                    job.id,
                    lease_id=lease_id,
                    lease_seconds=self._lease_seconds,
                    on_lost_lease=on_lost,
                )
            except LostLeaseError:
                self._teardown_to_queued(job.id, lease_id)
                return

            if abort_ev.is_set():
                self._teardown_to_queued(job.id, lease_id)
                return

            try:
                handler(job)
            except Exception as exc:
                if abort_ev.is_set():
                    self._teardown_to_queued(job.id, lease_id)
                    return
                # If still holding lease, mark failed; else CAS no-op
                ok = self._store.fail(
                    job.id, lease_id=lease_id, error=str(exc)
                )
                if not ok:
                    self._teardown_to_queued(job.id, lease_id)
                logger.exception("durable job %s failed", job.id)
        finally:
            with self._lock:
                self._active.pop(job.id, None)
                self._abort_flags.pop(job.id, None)

    def _teardown_to_queued(self, job_id: str, lease_id: str) -> None:
        """Attempt requeue only if we still own running+lease_id (cancel-wins)."""
        from agenticx.runtime.durable_jobs.models import JobStatus

        self._store.compare_swap(
            job_id,
            expect_status=JobStatus.RUNNING,
            expect_lease_id=lease_id,
            patch_status=JobStatus.QUEUED,
            clear_lease=True,
        )

    def shutdown(self, wait: bool = True, timeout: float = 5.0) -> None:
        self._stopped.set()
        with self._lock:
            threads = list(self._active.values())
            for ev in self._abort_flags.values():
                ev.set()
        if wait:
            for t in threads:
                t.join(timeout=timeout)
