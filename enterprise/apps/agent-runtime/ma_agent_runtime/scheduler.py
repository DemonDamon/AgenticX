#!/usr/bin/env python3
"""Multi-replica schedule ticker. Correctness comes from a unique slot and CAS.

Each runtime replica ticks. Inserts use ON CONFLICT DO NOTHING. Firing uses
``UPDATE ... WHERE status='scheduled'``. Missed slots are not replayed.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from agenticx.managed.errors import MAError
from agenticx.managed.host.config import Principal
from agenticx.managed.host.models import CreateSessionRequest
from agenticx.managed.ids import new_ulid

from ma_agent_runtime.config import Settings
from ma_agent_runtime.control_plane import AdminConsoleClient
from ma_agent_runtime.cron import CronError, next_fire, parse_cron, render_template
from ma_agent_runtime.pg_event_store import _insert_ignore
from ma_agent_runtime.tables import ma_schedule_runs

logger = logging.getLogger(__name__)

_SESSION_SCOPES = frozenset({"ma:sessions:read", "ma:sessions:write"})
_SUCCESS_STOPS = frozenset({"end_turn", "max_tool_rounds"})


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Any) -> datetime:
    if isinstance(value, datetime):
        current = value
    elif isinstance(value, str) and value:
        current = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError("expected a timestamp")
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def _rowcount(result: Any) -> int:
    count = getattr(result, "rowcount", 0)
    try:
        return int(count or 0)
    except (TypeError, ValueError):
        return 0


def _local_title(when: datetime, tz: str) -> str:
    try:
        local = _aware(when).astimezone(ZoneInfo(tz))
    except Exception:
        local = _aware(when)
    return f"定时任务 · {{name}} · {local:%Y-%m-%d %H:%M}"


class RuntimeSchedule:
    """One enabled schedule row from the control plane."""

    def __init__(self, raw: Mapping[str, Any]) -> None:
        self.id = str(raw.get("id") or "")
        self.tenant_id = str(raw.get("tenant_id") or "")
        self.name = str(raw.get("name") or "")
        self.agent_id = str(raw.get("agent_id") or "")
        self.version_policy = str(raw.get("version_policy") or "follow_routing")
        pinned = raw.get("pinned_version")
        self.pinned_version = int(pinned) if isinstance(pinned, int) else None
        environment = raw.get("environment_id")
        self.environment_id = str(environment) if isinstance(environment, str) and environment else None
        self.cron = str(raw.get("cron") or "")
        self.timezone = str(raw.get("timezone") or "Asia/Shanghai")
        self.input_template = str(raw.get("input_template") or "")
        vaults = raw.get("vault_ids") or []
        self.vault_ids = [str(item) for item in vaults] if isinstance(vaults, list) else []
        resources = raw.get("resources") or []
        self.resources = [item for item in resources if isinstance(item, dict)] if isinstance(resources, list) else []
        self.run_as_user_id = str(raw.get("run_as_user_id") or "")
        revision = raw.get("revision")
        self.revision = int(revision) if isinstance(revision, int) else 1
        grace = raw.get("misfire_grace_seconds")
        self.misfire_grace_seconds = int(grace) if isinstance(grace, int) else 300
        manual = raw.get("manual_run_requested_at")
        self.manual_run_requested_at = _aware(manual) if manual else None


class ScheduleTicker:
    """Plans and fires due schedule runs. Safe to run on every replica."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        client: AdminConsoleClient,
        service: Any,
        settings: Settings,
        clock: Callable[[], datetime] = utc_now,
        on_run_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self._engine = engine
        self._client = client
        self._service = service
        self._settings = settings
        self._clock = clock
        self._on_run_event = on_run_event

    async def tick(self) -> None:
        """One full pass. A failure on one schedule does not stop the others."""
        try:
            snapshot = await self._client.list_runtime_schedules()
        except Exception:
            logger.exception("schedule snapshot failed")
            return
        now = self._clock()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        raw_rows = snapshot.get("data") if isinstance(snapshot, dict) else None
        schedules = [RuntimeSchedule(item) for item in raw_rows or [] if isinstance(item, dict) and item.get("id")]
        disabled_raw = snapshot.get("disabled_ids") if isinstance(snapshot, dict) else None
        disabled_ids = {str(item) for item in disabled_raw or [] if isinstance(item, str)}
        enabled_ids = {item.id for item in schedules}
        by_id = {item.id: item for item in schedules}
        for schedule in schedules:
            try:
                await self._sync_schedule(schedule, now)
            except Exception:
                logger.exception("schedule sync failed schedule=%s", schedule.id)
        try:
            await self._skip_inactive(enabled_ids, disabled_ids, now)
        except Exception:
            logger.exception("schedule inactive sweep failed")
        try:
            await self._fire_due(by_id, now)
        except Exception:
            logger.exception("schedule fire pass failed")
        try:
            await self._timeouts(now)
        except Exception:
            logger.exception("schedule timeout pass failed")

    async def run_forever(self) -> None:
        while True:
            await self.tick()
            await asyncio.sleep(self._settings.scheduler_tick_seconds)

    async def on_terminal(self, tenant_id: str, session_id: str, event: Any) -> None:
        """Finish the run that owns ``session_id``, if it is still running."""
        now = self._clock()
        async with self._engine.connect() as conn:
            row = (
                await conn.execute(
                    select(ma_schedule_runs).where(
                        ma_schedule_runs.c.session_id == session_id,
                        ma_schedule_runs.c.tenant_id == tenant_id,
                        ma_schedule_runs.c.status == "running",
                    )
                )
            ).mappings().first()
        if row is None:
            return
        stop = "terminated"
        if getattr(event, "type", "") == "session.status_idle":
            payload = getattr(event, "payload", {}) or {}
            reason = payload.get("stop_reason") if isinstance(payload, dict) else None
            stop = str(reason.get("type")) if isinstance(reason, dict) and reason.get("type") else "unknown"
        if stop == "requires_action":
            await self._interrupt_session(tenant_id, session_id)
            if await self._mark(str(row["id"]), from_status=("running",), status="failed", now=now, error="requires_action") == 1:
                await self._emit_run_event("schedule_run.failed", row, session_id, "requires_action")
            return
        if stop in _SUCCESS_STOPS:
            if await self._mark(str(row["id"]), from_status=("running",), status="succeeded", now=now) == 1:
                await self._emit_run_event("schedule_run.succeeded", row, session_id, None)
            return
        error = (stop or "unknown")[:500]
        if await self._mark(
            str(row["id"]),
            from_status=("running",),
            status="failed",
            now=now,
            error=error,
        ) == 1:
            await self._emit_run_event("schedule_run.failed", row, session_id, error)

    async def _sync_schedule(self, schedule: RuntimeSchedule, now: datetime) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(ma_schedule_runs)
                .where(
                    ma_schedule_runs.c.schedule_id == schedule.id,
                    ma_schedule_runs.c.trigger == "schedule",
                    ma_schedule_runs.c.status == "scheduled",
                    ma_schedule_runs.c.schedule_revision != schedule.revision,
                )
                .values(status="skipped", skip_reason="revised", finished_at=now, updated_at=now)
            )
            await self._plan_next(conn, schedule, await self._anchor(conn, schedule.id, now), now)
            if schedule.manual_run_requested_at is not None:
                await self._insert_run(
                    conn,
                    schedule,
                    trigger="manual",
                    scheduled_for=schedule.manual_run_requested_at,
                    revision=schedule.revision,
                    now=now,
                )

    async def _anchor(self, conn: AsyncConnection, schedule_id: str, now: datetime) -> datetime:
        rows = (
            await conn.execute(
                select(
                    ma_schedule_runs.c.scheduled_for,
                    ma_schedule_runs.c.status,
                    ma_schedule_runs.c.skip_reason,
                ).where(
                    ma_schedule_runs.c.schedule_id == schedule_id,
                    ma_schedule_runs.c.trigger == "schedule",
                )
            )
        ).mappings()
        latest: datetime | None = None
        for row in rows:
            if row["status"] != "skipped" or row["skip_reason"] == "missed":
                stamp = _aware(row["scheduled_for"])
                if latest is None or stamp > latest:
                    latest = stamp
        if latest is None:
            return now
        return max(now, latest)

    async def _plan_next(
        self,
        conn: AsyncConnection,
        schedule: RuntimeSchedule,
        anchor: datetime,
        now: datetime,
    ) -> None:
        existing = (
            await conn.execute(
                select(ma_schedule_runs.c.id)
                .where(
                    ma_schedule_runs.c.schedule_id == schedule.id,
                    ma_schedule_runs.c.trigger == "schedule",
                    ma_schedule_runs.c.status == "scheduled",
                    ma_schedule_runs.c.schedule_revision == schedule.revision,
                )
                .limit(1)
            )
        ).first()
        if existing is not None:
            return
        try:
            at = next_fire(parse_cron(schedule.cron), schedule.timezone, anchor)
        except CronError:
            logger.exception("schedule next fire failed schedule=%s", schedule.id)
            return
        await self._insert_run(
            conn,
            schedule,
            trigger="schedule",
            scheduled_for=at,
            revision=schedule.revision,
            now=now,
        )

    async def _insert_run(
        self,
        conn: AsyncConnection,
        schedule: RuntimeSchedule,
        *,
        trigger: str,
        scheduled_for: datetime,
        revision: int,
        now: datetime,
    ) -> None:
        stmt = _insert_ignore(
            conn.dialect.name,
            ma_schedule_runs,
            ("schedule_id", "trigger", "scheduled_for"),
        )
        await conn.execute(
            stmt.values(
                id=new_ulid(),
                tenant_id=schedule.tenant_id,
                schedule_id=schedule.id,
                schedule_revision=revision,
                trigger=trigger,
                scheduled_for=scheduled_for,
                status="scheduled",
                created_at=now,
                updated_at=now,
            )
        )

    async def _skip_inactive(self, enabled_ids: set[str], disabled_ids: set[str], now: datetime) -> None:
        async with self._engine.begin() as conn:
            rows = (
                await conn.execute(
                    select(ma_schedule_runs.c.id, ma_schedule_runs.c.schedule_id).where(
                        ma_schedule_runs.c.status == "scheduled"
                    )
                )
            ).mappings()
            for row in rows:
                schedule_id = str(row["schedule_id"])
                if schedule_id in enabled_ids:
                    continue
                reason = "disabled" if schedule_id in disabled_ids else "deleted"
                await conn.execute(
                    update(ma_schedule_runs)
                    .where(ma_schedule_runs.c.id == row["id"], ma_schedule_runs.c.status == "scheduled")
                    .values(status="skipped", skip_reason=reason, finished_at=now, updated_at=now)
                )

    async def _fire_due(self, schedules: dict[str, RuntimeSchedule], now: datetime) -> None:
        async with self._engine.connect() as conn:
            rows = (
                await conn.execute(
                    select(ma_schedule_runs)
                    .where(ma_schedule_runs.c.status == "scheduled")
                    .order_by(ma_schedule_runs.c.scheduled_for)
                    .limit(50)
                )
            ).mappings().all()
        due = [row for row in rows if _aware(row["scheduled_for"]) <= now]
        for row in due:
            claimed = await self._claim(str(row["id"]), now)
            if not claimed:
                continue
            schedule = schedules.get(str(row["schedule_id"]))
            if schedule is None:
                await self._mark(str(row["id"]), from_status=("firing",), status="skipped", now=now, skip_reason="deleted")
                continue
            scheduled_for = _aware(row["scheduled_for"])
            if row["trigger"] == "schedule" and (now - scheduled_for).total_seconds() > schedule.misfire_grace_seconds:
                await self._mark(str(row["id"]), from_status=("firing",), status="skipped", now=now, skip_reason="missed")
                await self._plan_after(schedule, max(now, scheduled_for), now)
                continue
            if await self._overlaps(schedule.id, str(row["id"])):
                await self._mark(str(row["id"]), from_status=("firing",), status="skipped", now=now, skip_reason="overlap")
                await self._plan_after(schedule, max(now, scheduled_for), now)
                continue
            await self._fire(schedule, row, now)

    async def _claim(self, run_id: str, now: datetime) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                update(ma_schedule_runs)
                .where(ma_schedule_runs.c.id == run_id, ma_schedule_runs.c.status == "scheduled")
                .values(status="firing", updated_at=now)
            )
            return _rowcount(result) == 1

    async def _overlaps(self, schedule_id: str, run_id: str) -> bool:
        async with self._engine.connect() as conn:
            row = (
                await conn.execute(
                    select(ma_schedule_runs.c.id)
                    .where(
                        ma_schedule_runs.c.schedule_id == schedule_id,
                        ma_schedule_runs.c.status.in_(("firing", "running")),
                        ma_schedule_runs.c.id != run_id,
                    )
                    .limit(1)
                )
            ).first()
        return row is not None

    async def _fire(self, schedule: RuntimeSchedule, row: Mapping[str, Any], now: datetime) -> None:
        run_id = str(row["id"])
        principal = Principal(
            tenant_id=schedule.tenant_id,
            user_id=schedule.run_as_user_id,
            scopes=_SESSION_SCOPES,
        )
        title = _local_title(_aware(row["scheduled_for"]), schedule.timezone).replace("{name}", schedule.name)[:200]
        request = CreateSessionRequest(
            agent_id=schedule.agent_id,
            agent_version=schedule.pinned_version if schedule.version_policy == "pinned" else None,
            environment_id=schedule.environment_id,
            vault_ids=list(schedule.vault_ids),
            resources=list(schedule.resources),
            title=title,
            source="schedule",
        )
        session_id: str | None = None
        identity = {
            "id": run_id,
            "tenant_id": schedule.tenant_id,
            "schedule_id": schedule.id,
            "agent_id": schedule.agent_id,
        }
        try:
            record = await self._service.create_session(principal, request)
            session_id = record.id
            async with self._engine.begin() as conn:
                result = await conn.execute(
                    update(ma_schedule_runs)
                    .where(ma_schedule_runs.c.id == run_id, ma_schedule_runs.c.status == "firing")
                    .values(
                        status="running",
                        session_id=record.id,
                        agent_version=record.agent_version,
                        started_at=now,
                        updated_at=now,
                    )
                )
            if _rowcount(result) == 1:
                await self._emit_run_event("schedule_run.started", identity, session_id, None)
            text = render_template(
                schedule.input_template,
                scheduled_for=_aware(row["scheduled_for"]),
                tz=schedule.timezone,
                schedule_name=schedule.name,
                run_id=run_id,
            )
            await self._service.post_events(
                principal,
                record.id,
                {"events": [{"type": "user.message", "content": [{"type": "text", "text": text}]}]},
            )
        except MAError as exc:
            error = f"{exc.code}: {exc.message}"[:500]
            if await self._mark(
                run_id,
                from_status=("firing", "running"),
                status="failed",
                now=now,
                error=error,
            ) == 1:
                await self._emit_run_event("schedule_run.failed", identity, session_id, error)
        except Exception:
            logger.exception("schedule fire failed schedule=%s run=%s", schedule.id, run_id)
            if await self._mark(
                run_id,
                from_status=("firing", "running"),
                status="failed",
                now=now,
                error="internal_error",
            ) == 1:
                await self._emit_run_event("schedule_run.failed", identity, session_id, "internal_error")
        if row["trigger"] == "schedule":
            await self._plan_after(schedule, _aware(row["scheduled_for"]), now)

    async def _plan_after(self, schedule: RuntimeSchedule, anchor: datetime, now: datetime) -> None:
        async with self._engine.begin() as conn:
            await self._plan_next(conn, schedule, anchor, now)

    async def _timeouts(self, now: datetime) -> None:
        cutoff = now - timedelta(seconds=self._settings.schedule_run_timeout_seconds)
        async with self._engine.connect() as conn:
            rows = (
                await conn.execute(
                    select(ma_schedule_runs).where(
                        ma_schedule_runs.c.status == "running",
                        ma_schedule_runs.c.started_at < cutoff,
                    )
                )
            ).mappings().all()
        for row in rows:
            session_id = str(row["session_id"]) if row["session_id"] else None
            if session_id:
                await self._interrupt_session(str(row["tenant_id"]), session_id)
            if await self._mark(str(row["id"]), from_status=("running",), status="failed", now=now, error="timeout") == 1:
                await self._emit_run_event("schedule_run.failed", row, session_id, "timeout")

    async def _interrupt_session(self, tenant_id: str, session_id: str) -> None:
        try:
            session = await self._service.store.get_session(tenant_id, session_id)
        except Exception:
            logger.exception("schedule interrupt lookup failed session=%s", session_id)
            return
        user_id = getattr(session, "created_by_user_id", None) if session is not None else None
        if not user_id:
            logger.error("schedule interrupt missing user session=%s", session_id)
            return
        principal = Principal(tenant_id=tenant_id, user_id=str(user_id), scopes=_SESSION_SCOPES)
        try:
            await self._service.post_events(
                principal,
                session_id,
                {"events": [{"type": "user.interrupt"}]},
            )
        except Exception:
            logger.exception("schedule interrupt failed session=%s", session_id)

    async def _mark(
        self,
        run_id: str,
        *,
        from_status: tuple[str, ...],
        status: str,
        now: datetime,
        error: str | None = None,
        skip_reason: str | None = None,
    ) -> int:
        values: dict[str, Any] = {"status": status, "updated_at": now}
        if status in {"succeeded", "failed", "skipped"}:
            values["finished_at"] = now
        if error is not None:
            values["error"] = error[:500]
        if skip_reason is not None:
            values["skip_reason"] = skip_reason
        async with self._engine.begin() as conn:
            result = await conn.execute(
                update(ma_schedule_runs)
                .where(and_(ma_schedule_runs.c.id == run_id, ma_schedule_runs.c.status.in_(from_status)))
                .values(**values)
            )
        return _rowcount(result)

    async def _emit_run_event(
        self,
        event_type: str,
        row_or_ids: Mapping[str, Any],
        session_id: str | None,
        error: str | None,
    ) -> None:
        if self._on_run_event is None:
            return
        try:
            run_id = str(row_or_ids.get("schedule_run_id") or row_or_ids.get("id") or "")
            tenant_id = str(row_or_ids.get("tenant_id") or "")
            schedule_id = str(row_or_ids.get("schedule_id") or "")
            agent_raw = row_or_ids.get("agent_id")
            agent_id = agent_raw if isinstance(agent_raw, str) and agent_raw else ""
            if not agent_id:
                agent_id = await self._session_agent_id(tenant_id, session_id)
            data = {
                "type": event_type,
                "tenant_id": tenant_id,
                "schedule_id": schedule_id,
                "schedule_run_id": run_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "error": error,
            }
            await self._on_run_event(data)
        except Exception:
            logger.exception("schedule run event failed type=%s", event_type)

    async def _session_agent_id(self, tenant_id: str, session_id: str | None) -> str:
        if not session_id:
            return ""
        store = getattr(self._service, "store", None)
        get_session = getattr(store, "get_session", None)
        if get_session is None:
            return ""
        try:
            session = await get_session(tenant_id, session_id)
        except Exception:
            logger.exception("schedule run event lookup failed session=%s", session_id)
            return ""
        agent_id = getattr(session, "agent_id", None) if session is not None else None
        return agent_id if isinstance(agent_id, str) else ""


__all__ = [
    "RuntimeSchedule",
    "ScheduleTicker",
    "utc_now",
]
