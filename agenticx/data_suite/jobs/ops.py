"""DataFlow job ops: bind JobSpec ↔ managed-style schedule / schedule_run.

Shares the schedule/schedule_run *shape* with Meta-Agent automation and the A8
webhook sink with patrol ticks, but is a dedicated DataFlow job ops surface —
not MA agent sessions and not the S2-7 patrol Agent.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Sequence

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.jobs.dsl import JobSpec
from agenticx.data_suite.jobs.nodes import IdMapLike
from agenticx.data_suite.jobs.runner import JobRunResult, run_job
from agenticx.data_suite.jobs.scheduler import cron_matches
from agenticx.managed.templates.data_suite.webhook import (
    FakeWebhookSink,
    HttpWebhookSink,
    Sink,
    WebhookNotifier,
)

Trigger = Literal["schedule", "manual", "backfill", "replay"]
RunStatus = Literal["running", "succeeded", "failed"]

FAIL_WEBHOOK_KIND = "data_job.run_failed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@dataclass
class DataJobSchedule:
    id: str
    job_id: str
    cron: str
    enabled: bool = True
    webhook_url: Optional[str] = None


@dataclass
class DataJobScheduleRun:
    id: str
    schedule_id: str
    job_id: str
    trigger: Trigger
    status: RunStatus
    snapshot_id: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    scheduled_for: Optional[datetime] = None
    replay_of_snapshot_id: Optional[str] = None
    row_count: int = 0
    written: int = 0


@dataclass
class DataJobOpsService:
    """In-process DataFlow schedule binding + run history + failure alerts."""

    jobs: Dict[str, JobSpec] = field(default_factory=dict)
    schedules: Dict[str, DataJobSchedule] = field(default_factory=dict)
    runs: List[DataJobScheduleRun] = field(default_factory=list)
    sink: Optional[Sink] = None

    def register_job(self, spec: JobSpec) -> JobSpec:
        if not spec.name:
            raise ValueError("JobSpec.name is required")
        self.jobs[spec.name] = spec
        return spec

    def bind_schedule(
        self,
        job_id: str,
        *,
        cron: str,
        schedule_id: Optional[str] = None,
        webhook_url: Optional[str] = None,
        enabled: bool = True,
    ) -> DataJobSchedule:
        if job_id not in self.jobs:
            raise KeyError(f"unknown job_id: {job_id!r}")
        cron_s = (cron or "").strip()
        if len(cron_s.split()) != 5:
            raise ValueError("cron must be a 5-field expression")
        sid = (schedule_id or "").strip() or _new_id("sch")
        sched = DataJobSchedule(
            id=sid,
            job_id=job_id,
            cron=cron_s,
            enabled=enabled,
            webhook_url=webhook_url,
        )
        self.schedules[sid] = sched
        return sched

    def list_jobs(self) -> List[JobSpec]:
        return list(self.jobs.values())

    def list_schedules(self) -> List[DataJobSchedule]:
        return list(self.schedules.values())

    def list_runs(
        self,
        *,
        job_id: Optional[str] = None,
        schedule_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[DataJobScheduleRun]:
        rows = list(self.runs)
        if job_id:
            rows = [r for r in rows if r.job_id == job_id]
        if schedule_id:
            rows = [r for r in rows if r.schedule_id == schedule_id]
        rows.sort(key=lambda r: r.started_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return rows[: max(1, min(limit, 200))]

    def _notifier_for(self, schedule: Optional[DataJobSchedule]) -> tuple[WebhookNotifier, Sink]:
        if self.sink is not None:
            sink: Sink = self.sink
        elif schedule and schedule.webhook_url:
            sink = HttpWebhookSink(schedule.webhook_url)
        else:
            sink = FakeWebhookSink()
        return WebhookNotifier(sink), sink

    def _emit_failure(
        self,
        schedule: Optional[DataJobSchedule],
        run: DataJobScheduleRun,
    ) -> None:
        notifier, _ = self._notifier_for(schedule)
        notifier.emit(
            FAIL_WEBHOOK_KIND,
            job_id=run.job_id,
            run_id=run.id,
            schedule_id=run.schedule_id,
            error=run.error,
            snapshot_id=run.snapshot_id,
            trigger=run.trigger,
        )

    async def _execute(
        self,
        *,
        spec: JobSpec,
        schedule: Optional[DataJobSchedule],
        trigger: Trigger,
        channels: ChannelRegistry,
        idmaps: Optional[Dict[str, IdMapLike]] = None,
        scheduled_for: Optional[datetime] = None,
        replay_of_snapshot_id: Optional[str] = None,
    ) -> DataJobScheduleRun:
        run = DataJobScheduleRun(
            id=_new_id("run"),
            schedule_id=schedule.id if schedule else "manual",
            job_id=spec.name,
            trigger=trigger,
            status="running",
            started_at=_utc_now(),
            scheduled_for=scheduled_for,
            replay_of_snapshot_id=replay_of_snapshot_id,
        )
        self.runs.append(run)
        result: JobRunResult = await run_job(spec, channels=channels, idmaps=idmaps)
        run.finished_at = _utc_now()
        run.row_count = result.row_count
        run.written = result.written
        run.snapshot_id = result.snapshot_id
        if result.ok:
            run.status = "succeeded"
            run.error = None
        else:
            run.status = "failed"
            run.error = result.error or "job failed"
            self._emit_failure(schedule, run)
        return run

    def _require_job(self, job_id: str) -> JobSpec:
        spec = self.jobs.get(job_id)
        if spec is None:
            raise KeyError(f"unknown job_id: {job_id!r}")
        return spec

    def _schedule_for_job(self, job_id: str) -> Optional[DataJobSchedule]:
        for s in self.schedules.values():
            if s.job_id == job_id:
                return s
        return None

    async def tick(
        self,
        now: Optional[datetime] = None,
        *,
        channels: ChannelRegistry,
        idmaps: Optional[Dict[str, IdMapLike]] = None,
        schedule_ids: Optional[Sequence[str]] = None,
    ) -> List[DataJobScheduleRun]:
        """Fire enabled schedules whose cron matches ``now``; each creates one schedule_run."""
        when = now or datetime.now()
        # cron_matches expects naive local-like datetime fields
        if when.tzinfo is not None:
            when_naive = when.replace(tzinfo=None)
        else:
            when_naive = when

        out: List[DataJobScheduleRun] = []
        for sched in self.schedules.values():
            if schedule_ids is not None and sched.id not in schedule_ids:
                continue
            if not sched.enabled:
                continue
            if not cron_matches(sched.cron, when_naive):
                continue
            spec = self._require_job(sched.job_id)
            run = await self._execute(
                spec=spec,
                schedule=sched,
                trigger="schedule",
                channels=channels,
                idmaps=idmaps,
                scheduled_for=when if when.tzinfo else when.replace(tzinfo=timezone.utc),
            )
            out.append(run)
        return out

    async def rerun(
        self,
        job_id: str,
        *,
        channels: ChannelRegistry,
        idmaps: Optional[Dict[str, IdMapLike]] = None,
    ) -> DataJobScheduleRun:
        """Manual 重跑：run job once and append history."""
        spec = self._require_job(job_id)
        schedule = self._schedule_for_job(job_id)
        return await self._execute(
            spec=spec,
            schedule=schedule,
            trigger="manual",
            channels=channels,
            idmaps=idmaps,
        )

    async def backfill(
        self,
        job_id: str,
        *,
        scheduled_for: datetime,
        channels: ChannelRegistry,
        idmaps: Optional[Dict[str, IdMapLike]] = None,
    ) -> DataJobScheduleRun:
        """补数：manual-style run tagged with a historical ``scheduled_for``."""
        spec = self._require_job(job_id)
        schedule = self._schedule_for_job(job_id)
        return await self._execute(
            spec=spec,
            schedule=schedule,
            trigger="backfill",
            channels=channels,
            idmaps=idmaps,
            scheduled_for=scheduled_for,
        )

    async def replay_snapshot(
        self,
        job_id: str,
        *,
        snapshot_id: str,
        channels: ChannelRegistry,
        idmaps: Optional[Dict[str, IdMapLike]] = None,
    ) -> DataJobScheduleRun:
        """快照回放入口：re-run job and record ``replay_of_snapshot_id``.

        P0 does not restore row state from the snapshot blob; it re-executes the
        JobSpec and links the new run to the prior snapshot id for ops UX.
        """
        snap = (snapshot_id or "").strip()
        if not snap:
            raise ValueError("snapshot_id is required")
        spec = self._require_job(job_id)
        schedule = self._schedule_for_job(job_id)
        return await self._execute(
            spec=spec,
            schedule=schedule,
            trigger="replay",
            channels=channels,
            idmaps=idmaps,
            replay_of_snapshot_id=snap,
        )


def runs_as_dicts(runs: Sequence[DataJobScheduleRun]) -> List[Dict[str, Any]]:
    """Serialize runs for admin / golden-path evidence (ISO timestamps)."""

    def _ts(v: Optional[datetime]) -> Optional[str]:
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()

    return [
        {
            "id": r.id,
            "schedule_id": r.schedule_id,
            "job_id": r.job_id,
            "trigger": r.trigger,
            "status": r.status,
            "snapshot_id": r.snapshot_id,
            "error": r.error,
            "started_at": _ts(r.started_at),
            "finished_at": _ts(r.finished_at),
            "scheduled_for": _ts(r.scheduled_for),
            "replay_of_snapshot_id": r.replay_of_snapshot_id,
            "row_count": r.row_count,
            "written": r.written,
        }
        for r in runs
    ]
