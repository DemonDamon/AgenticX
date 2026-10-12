#!/usr/bin/env python3
"""SQLite durable job store with column-equality CAS leases.

CAS uses scalar column equality (status / lease_id), never JSON containment.

Author: Damon Li
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from agenticx.runtime.durable_jobs.models import (
    CLAIMABLE_STATUSES,
    DurableJob,
    JobStatus,
)

ClockFn = Callable[[], float]
AbortFn = Callable[[str], None]

_DEFAULT_DB = Path.home() / ".agenticx" / "durable_jobs.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_id TEXT,
  lease_until REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  updated_at REAL NOT NULL,
  resume_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_status
  ON durable_jobs(status, lease_until);
"""


class LostLeaseError(Exception):
    """Raised when heartbeat CAS fails because the lease was lost."""

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        super().__init__(f"lost lease on job {job_id}")


class DurableJobStore:
    """Thread-safe SQLite store for durable job lifecycle + leases."""

    def __init__(
        self,
        db_path: Path | None = None,
        clock: ClockFn | None = None,
    ) -> None:
        self._path = Path(db_path) if db_path else _DEFAULT_DB
        self._clock: ClockFn = clock or time.time
        self._lock = threading.Lock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._path), timeout=60.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(_SCHEMA)
                conn.commit()
            finally:
                conn.close()

    def _now(self) -> float:
        return float(self._clock())

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> DurableJob:
        payload = json.loads(row["payload_json"] or "{}")
        automation_task_id = payload.get("automation_task_id")
        if isinstance(automation_task_id, str):
            auto_id: Optional[str] = automation_task_id
        else:
            auto_id = None
        return DurableJob(
            id=row["id"],
            owner=row["owner"],
            kind=row["kind"],
            status=JobStatus(row["status"]),
            lease_id=row["lease_id"],
            lease_until=row["lease_until"],
            attempts=int(row["attempts"] or 0),
            payload=payload,
            error=row["error"],
            updated_at=float(row["updated_at"] or 0.0),
            automation_task_id=auto_id,
            resume_status=row["resume_status"],
        )

    def create(
        self,
        *,
        owner: str,
        kind: str,
        payload: Optional[Dict[str, Any]] = None,
        job_id: Optional[str] = None,
        status: JobStatus = JobStatus.QUEUED,
    ) -> DurableJob:
        jid = job_id or f"dj_{uuid.uuid4().hex[:16]}"
        now = self._now()
        body = dict(payload or {})
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO durable_jobs (
                      id, owner, kind, status, lease_id, lease_until,
                      attempts, payload_json, error, updated_at, resume_status
                    ) VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, NULL, ?, NULL)
                    """,
                    (jid, owner, kind, status.value, json.dumps(body), now),
                )
                conn.commit()
            finally:
                conn.close()
        job = self.get(jid)
        assert job is not None
        return job

    def get(self, job_id: str) -> Optional[DurableJob]:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM durable_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return None
        return self._row_to_job(row)

    def list_claimable(self, *, limit: int = 16) -> list[DurableJob]:
        """Return jobs that are queued/scheduled or running with expired lease."""
        now = self._now()
        claimable = tuple(s.value for s in CLAIMABLE_STATUSES)
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    f"""
                    SELECT * FROM durable_jobs
                    WHERE status IN ({",".join("?" * len(claimable))})
                       OR (status = ? AND lease_until IS NOT NULL AND lease_until < ?)
                    ORDER BY updated_at ASC
                    LIMIT ?
                    """,
                    (*claimable, JobStatus.RUNNING.value, now, limit),
                ).fetchall()
            finally:
                conn.close()
        return [self._row_to_job(r) for r in rows]

    def claim(
        self,
        job_id: str,
        *,
        worker_id: str,
        lease_seconds: float = 30.0,
    ) -> Optional[DurableJob]:
        """CAS claim: queued/scheduled, or running with expired lease."""
        now = self._now()
        lease_id = f"lease_{worker_id}_{uuid.uuid4().hex[:12]}"
        lease_until = now + float(lease_seconds)
        claimable = tuple(s.value for s in CLAIMABLE_STATUSES)
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    f"""
                    UPDATE durable_jobs
                    SET status = ?,
                        lease_id = ?,
                        lease_until = ?,
                        attempts = attempts + 1,
                        updated_at = ?,
                        error = NULL
                    WHERE id = ?
                      AND (
                        status IN ({",".join("?" * len(claimable))})
                        OR (
                          status = ?
                          AND lease_until IS NOT NULL
                          AND lease_until < ?
                        )
                      )
                    """,
                    (
                        JobStatus.RUNNING.value,
                        lease_id,
                        lease_until,
                        now,
                        job_id,
                        *claimable,
                        JobStatus.RUNNING.value,
                        now,
                    ),
                )
                conn.commit()
                if cur.rowcount != 1:
                    return None
                row = conn.execute(
                    "SELECT * FROM durable_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return None
        return self._row_to_job(row)

    def heartbeat(
        self,
        job_id: str,
        *,
        lease_id: str,
        lease_seconds: float = 30.0,
        on_lost_lease: Optional[AbortFn] = None,
    ) -> DurableJob:
        """Extend lease_until when status=running and lease_id matches."""
        now = self._now()
        lease_until = now + float(lease_seconds)
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    """
                    UPDATE durable_jobs
                    SET lease_until = ?, updated_at = ?
                    WHERE id = ?
                      AND status = ?
                      AND lease_id = ?
                    """,
                    (
                        lease_until,
                        now,
                        job_id,
                        JobStatus.RUNNING.value,
                        lease_id,
                    ),
                )
                conn.commit()
                ok = cur.rowcount == 1
            finally:
                conn.close()
        if not ok:
            if on_lost_lease is not None:
                on_lost_lease(job_id)
            raise LostLeaseError(job_id)
        job = self.get(job_id)
        assert job is not None
        return job

    def checkpoint(
        self,
        job_id: str,
        *,
        lease_id: str,
        payload_patch: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Persist payload merge while holding the lease."""
        job = self.get(job_id)
        if job is None:
            return False
        if job.status != JobStatus.RUNNING or job.lease_id != lease_id:
            return False
        merged = dict(job.payload)
        if payload_patch:
            merged.update(payload_patch)
        now = self._now()
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    """
                    UPDATE durable_jobs
                    SET payload_json = ?, updated_at = ?
                    WHERE id = ?
                      AND status = ?
                      AND lease_id = ?
                    """,
                    (
                        json.dumps(merged),
                        now,
                        job_id,
                        JobStatus.RUNNING.value,
                        lease_id,
                    ),
                )
                conn.commit()
                return cur.rowcount == 1
            finally:
                conn.close()

    def complete(self, job_id: str, *, lease_id: str) -> bool:
        return self.compare_swap(
            job_id,
            expect_status=JobStatus.RUNNING,
            expect_lease_id=lease_id,
            patch_status=JobStatus.SUCCEEDED,
            clear_lease=True,
            clear_error=True,
        )

    def fail(self, job_id: str, *, lease_id: str, error: str) -> bool:
        return self.compare_swap(
            job_id,
            expect_status=JobStatus.RUNNING,
            expect_lease_id=lease_id,
            patch_status=JobStatus.FAILED,
            clear_lease=True,
            error=error,
        )

    def compare_swap(
        self,
        job_id: str,
        *,
        expect_status: JobStatus,
        expect_lease_id: Optional[str],
        patch_status: JobStatus,
        clear_lease: bool = False,
        clear_error: bool = False,
        error: Optional[str] = None,
        resume_status: Optional[str] = None,
    ) -> bool:
        """Column-equality CAS. Returns True iff exactly one row updated."""
        now = self._now()
        sets = ["status = ?", "updated_at = ?"]
        params: list[Any] = [patch_status.value, now]
        if clear_lease:
            sets.append("lease_id = NULL")
            sets.append("lease_until = NULL")
        if clear_error:
            sets.append("error = NULL")
        elif error is not None:
            sets.append("error = ?")
            params.append(error)
        if resume_status is not None:
            sets.append("resume_status = ?")
            params.append(resume_status)
        elif patch_status != JobStatus.PAUSED:
            # Clear resume marker when leaving paused via other paths
            if patch_status in (
                JobStatus.QUEUED,
                JobStatus.RUNNING,
                JobStatus.CANCELLED,
                JobStatus.SUCCEEDED,
                JobStatus.FAILED,
            ):
                sets.append("resume_status = NULL")

        where = ["id = ?", "status = ?"]
        params.extend([job_id, expect_status.value])
        if expect_lease_id is None:
            where.append("lease_id IS NULL")
        else:
            where.append("lease_id = ?")
            params.append(expect_lease_id)

        sql = (
            f"UPDATE durable_jobs SET {', '.join(sets)} "
            f"WHERE {' AND '.join(where)}"
        )
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(sql, params)
                conn.commit()
                return cur.rowcount == 1
            finally:
                conn.close()

    def control(self, job_id: str, *, action: str) -> bool:
        """pause | resume | cancel | retry. Cancel clears lease first (cancel-wins)."""
        job = self.get(job_id)
        if job is None:
            return False
        action = action.lower().strip()
        now = self._now()

        if action == "cancel":
            if job.status in (
                JobStatus.SUCCEEDED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
            ):
                return False
            with self._lock:
                conn = self._connect()
                try:
                    cur = conn.execute(
                        """
                        UPDATE durable_jobs
                        SET status = ?,
                            lease_id = NULL,
                            lease_until = NULL,
                            updated_at = ?,
                            resume_status = NULL
                        WHERE id = ?
                          AND status NOT IN (?, ?, ?)
                        """,
                        (
                            JobStatus.CANCELLED.value,
                            now,
                            job_id,
                            JobStatus.SUCCEEDED.value,
                            JobStatus.FAILED.value,
                            JobStatus.CANCELLED.value,
                        ),
                    )
                    conn.commit()
                    return cur.rowcount == 1
                finally:
                    conn.close()

        if action == "pause":
            if job.status != JobStatus.RUNNING:
                return False
            with self._lock:
                conn = self._connect()
                try:
                    cur = conn.execute(
                        """
                        UPDATE durable_jobs
                        SET status = ?,
                            lease_id = NULL,
                            lease_until = NULL,
                            resume_status = ?,
                            updated_at = ?
                        WHERE id = ?
                          AND status = ?
                        """,
                        (
                            JobStatus.PAUSED.value,
                            JobStatus.RUNNING.value,
                            now,
                            job_id,
                            JobStatus.RUNNING.value,
                        ),
                    )
                    conn.commit()
                    return cur.rowcount == 1
                finally:
                    conn.close()

        if action == "resume":
            if job.status != JobStatus.PAUSED:
                return False
            target = job.resume_status or JobStatus.QUEUED.value
            # Resume into queued so a worker can claim again
            if target == JobStatus.RUNNING.value:
                target = JobStatus.QUEUED.value
            with self._lock:
                conn = self._connect()
                try:
                    cur = conn.execute(
                        """
                        UPDATE durable_jobs
                        SET status = ?,
                            resume_status = NULL,
                            updated_at = ?
                        WHERE id = ?
                          AND status = ?
                        """,
                        (target, now, job_id, JobStatus.PAUSED.value),
                    )
                    conn.commit()
                    return cur.rowcount == 1
                finally:
                    conn.close()

        if action == "retry":
            # Hook: future ActionProposal gate — reject if attached proposal
            # is not succeeded. For now only failed jobs may retry.
            if job.status != JobStatus.FAILED:
                return False
            # Optional hook placeholder for proposal outcome checks
            if not self._proposal_allows_retry(job):
                return False
            with self._lock:
                conn = self._connect()
                try:
                    cur = conn.execute(
                        """
                        UPDATE durable_jobs
                        SET status = ?,
                            lease_id = NULL,
                            lease_until = NULL,
                            error = NULL,
                            updated_at = ?
                        WHERE id = ?
                          AND status = ?
                        """,
                        (
                            JobStatus.QUEUED.value,
                            now,
                            job_id,
                            JobStatus.FAILED.value,
                        ),
                    )
                    conn.commit()
                    return cur.rowcount == 1
                finally:
                    conn.close()

        return False

    def _proposal_allows_retry(self, job: DurableJob) -> bool:
        """Hook for ActionProposal gating (plan FR-5). Always True until wired."""
        _ = job
        return True
