#!/usr/bin/env python3
"""User x agent token quotas for managed sessions.

Day, week (Monday), and month boundaries are computed in ``MA_QUOTA_TIMEZONE``
and stored as UTC instants when reading ``ma_session_usage``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import text
from sqlalchemy.engine import Engine

from agenticx.managed.budget import BudgetExceededError
from agenticx.managed.events.adapter import TurnOutcome
from agenticx.managed.events.state_machine import session_error_event
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.actor import SessionActor, TurnExecutor
from agenticx.managed.host.service import SessionService
from agenticx.managed.ids import utc_now_iso
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.protocol import ClientEvent, EnvironmentType

from ma_agent_runtime.config import Settings

logger = logging.getLogger(__name__)

PERIODS = ("daily", "weekly", "monthly")

USAGE_SQL = """
SELECT
  COALESCE(SUM(CASE WHEN created_at >= :day THEN input_tokens + output_tokens ELSE 0 END), 0) AS daily,
  COALESCE(SUM(CASE WHEN created_at >= :week THEN input_tokens + output_tokens ELSE 0 END), 0) AS weekly,
  COALESCE(SUM(CASE WHEN created_at >= :month THEN input_tokens + output_tokens ELSE 0 END), 0) AS monthly
FROM ma_session_usage
WHERE tenant_id = :tenant AND agent_id = :agent AND user_id = :user AND created_at >= :earliest
"""


def utc_now() -> datetime:
    """Current time as an aware UTC datetime."""
    return datetime.now(timezone.utc)


def window_starts(now: datetime, tz: ZoneInfo) -> dict[str, datetime]:
    """UTC instants of the local day, Monday, and month that contain ``now``."""
    aware = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    local = aware.astimezone(tz)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    week = start - timedelta(days=start.weekday())
    month = start.replace(day=1)
    return {
        "daily": start.astimezone(timezone.utc),
        "weekly": week.astimezone(timezone.utc),
        "monthly": month.astimezone(timezone.utc),
    }


@dataclass(frozen=True)
class QuotaRule:
    source: Literal["user", "default"]
    rule_id: str
    daily_tokens: int
    weekly_tokens: int
    monthly_tokens: int


@dataclass(frozen=True)
class QuotaDecision:
    exceeded: bool
    period: str | None = None
    used: int = 0
    limit: int = 0


@dataclass
class _CachedRule:
    rule: QuotaRule | None
    stored_at: float


def _as_int(value: object) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return number


def _tokens_from_result(item: object) -> int:
    """Input plus output tokens from a stream usage chunk or an invoke response."""
    if isinstance(item, Mapping) and item.get("type") == "usage":
        usage = item.get("usage")
        if isinstance(usage, Mapping):
            return _as_int(usage.get("prompt_tokens") or usage.get("input_tokens")) + _as_int(
                usage.get("completion_tokens") or usage.get("output_tokens")
            )
        return 0
    token_usage = getattr(item, "token_usage", None)
    if token_usage is None:
        return 0
    if isinstance(token_usage, Mapping):
        return _as_int(token_usage.get("prompt_tokens") or token_usage.get("input_tokens")) + _as_int(
            token_usage.get("completion_tokens") or token_usage.get("output_tokens")
        )
    return _as_int(getattr(token_usage, "prompt_tokens", 0) or getattr(token_usage, "input_tokens", 0)) + _as_int(
        getattr(token_usage, "completion_tokens", 0) or getattr(token_usage, "output_tokens", 0)
    )


class AgentQuotaEnforcer:
    """Synchronous on purpose: the runtime calls LLMs from worker threads."""

    def __init__(
        self,
        *,
        sync_engine: Engine,
        admin_url: str,
        internal_token: str,
        settings: Settings,
        http: httpx.Client | None = None,
        clock: Callable[[], datetime] = utc_now,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._engine = sync_engine
        self._admin_url = admin_url.rstrip("/")
        self._settings = settings
        self._clock = clock
        self._monotonic = monotonic
        self._zone = ZoneInfo(settings.quota_timezone)
        self._http = http or httpx.Client(
            timeout=5.0,
            trust_env=False,
            headers={"Authorization": f"Bearer {internal_token}"},
        )
        self._rules: dict[str, _CachedRule] = {}
        self._warn_at: dict[tuple[str, str], float] = {}
        self._pending: dict[tuple[str, str, str], int] = {}
        self._last_sql_monthly: dict[tuple[str, str, str], int] = {}
        self._lock = threading.Lock()

    def rule_for(self, tenant_id: str, agent_id: str, user_id: str) -> QuotaRule | None:
        """Return the effective rule, including a cached null, or None when unknown."""
        key = f"{tenant_id}|{agent_id}|{user_id}"
        now = self._monotonic()
        cached = self._rules.get(key)
        if cached is not None and now - cached.stored_at <= self._settings.agent_quota_cache_seconds:
            return cached.rule
        try:
            rule = self._fetch(tenant_id, agent_id, user_id)
        except Exception:
            self._warn(tenant_id, agent_id, "quota control plane unavailable; allowing the request")
            if cached is not None and now - cached.stored_at <= self._settings.agent_quota_stale_seconds:
                return cached.rule
            return None
        self._rules[key] = _CachedRule(rule, now)
        return rule

    def usage(self, tenant_id: str, agent_id: str, user_id: str, now: datetime) -> dict[str, int]:
        """Sum input+output tokens inside the current local day, week, and month."""
        windows = window_starts(now, self._zone)
        earliest = min(windows.values())
        with self._engine.connect() as conn:
            row = conn.execute(
                text(USAGE_SQL),
                {
                    "day": windows["daily"],
                    "week": windows["weekly"],
                    "month": windows["monthly"],
                    "tenant": tenant_id,
                    "agent": agent_id,
                    "user": user_id,
                    "earliest": earliest,
                },
            ).mappings().one()
        sql_totals = {
            "daily": _as_int(row["daily"]),
            "weekly": _as_int(row["weekly"]),
            "monthly": _as_int(row["monthly"]),
        }
        key = (tenant_id, agent_id, user_id)
        with self._lock:
            pending = self._pending.get(key, 0)
            last_sql = self._last_sql_monthly.get(key, 0)
            current = sql_totals["monthly"]
            if current > last_sql:
                pending = max(0, pending - (current - last_sql))
                self._pending[key] = pending
            self._last_sql_monthly[key] = current
        return {period: sql_totals[period] + pending for period in PERIODS}

    def check(self, tenant_id: str, agent_id: str, user_id: str | None) -> QuotaDecision:
        """Return whether ``user_id`` is already at or over a positive limit."""
        if user_id is None or not self._settings.agent_quota_enabled:
            return QuotaDecision(False)
        rule = self.rule_for(tenant_id, agent_id, user_id)
        if rule is None:
            return QuotaDecision(False)
        try:
            used = self.usage(tenant_id, agent_id, user_id, self._clock())
        except Exception:
            self._warn(tenant_id, agent_id, "quota usage query failed; allowing the request")
            return QuotaDecision(False)
        for period in PERIODS:
            limit = int(getattr(rule, f"{period}_tokens"))
            if limit > 0 and used[period] >= limit:
                return QuotaDecision(True, period, used[period], limit)
        return QuotaDecision(False)

    def guard(self, context: LLMCallContext) -> None:
        """Raise when the session initiator is already over a token limit."""
        decision = self.check(context.tenant_id, context.agent_id, context.user_id)
        if decision.exceeded and decision.period is not None:
            raise BudgetExceededError(period=decision.period, used=decision.used, limit=decision.limit)

    def note_model_result(self, context: LLMCallContext, item: object) -> None:
        """Remember tokens from a call the usage table has not caught up with yet."""
        if context.user_id is None:
            return
        tokens = _tokens_from_result(item)
        if tokens <= 0:
            return
        key = (context.tenant_id, context.agent_id, context.user_id)
        with self._lock:
            self._pending[key] = self._pending.get(key, 0) + tokens

    def close(self) -> None:
        """Close the control-plane HTTP client."""
        self._http.close()

    def _fetch(self, tenant_id: str, agent_id: str, user_id: str) -> QuotaRule | None:
        response = self._http.get(
            f"{self._admin_url}/api/internal/ma/agent-quotas/effective",
            params={"tenant_id": tenant_id, "agent_id": agent_id, "user_id": user_id},
        )
        if response.status_code != 200:
            raise RuntimeError(f"quota control plane status {response.status_code}")
        body = response.json()
        if not isinstance(body, dict):
            raise RuntimeError("quota control plane payload")
        quota = body.get("quota")
        if quota is None:
            return None
        if not isinstance(quota, dict):
            raise RuntimeError("quota control plane payload")
        source = quota.get("source")
        if source not in ("user", "default"):
            raise RuntimeError("quota control plane payload")
        return QuotaRule(
            source=source,
            rule_id=str(quota.get("rule_id") or ""),
            daily_tokens=_as_int(quota.get("daily_tokens")),
            weekly_tokens=_as_int(quota.get("weekly_tokens")),
            monthly_tokens=_as_int(quota.get("monthly_tokens")),
        )

    def _warn(self, tenant_id: str, agent_id: str, message: str) -> None:
        key = (tenant_id, agent_id)
        now = self._monotonic()
        last = self._warn_at.get(key)
        if last is not None and now - last < 60:
            return
        self._warn_at[key] = now
        logger.warning("%s tenant=%s agent=%s", message, tenant_id, agent_id)


class BudgetAdmissionExecutor:
    """Wraps a TurnExecutor; rejects a new turn when the quota is exhausted."""

    def __init__(self, inner: TurnExecutor, actor: SessionActor, enforcer: AgentQuotaEnforcer) -> None:
        self._inner = inner
        self._actor = actor
        self._enforcer = enforcer

    async def submit_message(self, message: StoredEvent) -> None:
        """Called with the actor lock held."""
        actor = self._actor
        sm = actor.sm
        if sm.status != "idle" or (sm.stop_reason is not None and sm.stop_reason.type == "requires_action"):
            await self._inner.submit_message(message)
            return
        decision = await asyncio.to_thread(
            self._enforcer.check,
            actor.tenant_id,
            actor.record.agent_id,
            actor.record.created_by_user_id,
        )
        if not decision.exceeded or decision.period is None:
            await self._inner.submit_message(message)
            return
        err = BudgetExceededError(period=decision.period, used=decision.used, limit=decision.limit)
        await actor.begin_turn_locked()
        await actor.service.store.mark_processed(
            actor.tenant_id,
            actor.session_id,
            [message.id],
            utc_now_iso(),
        )
        await actor.finish_turn_locked(
            TurnOutcome(
                stop_type="budget_exceeded",
                events=[session_error_event("budget_exceeded", str(err)[:500], "terminal")],
                usage=actor.record.usage,
            )
        )

    async def on_resolved(self, resolutions: Mapping[str, ClientEvent]) -> None:
        await self._inner.on_resolved(resolutions)

    async def interrupt(self, dropped_pending: Sequence[str]) -> None:
        await self._inner.interrupt(dropped_pending)

    async def close(self) -> None:
        await self._inner.close()


def wrap_executors_with_quota(service: SessionService, enforcer: AgentQuotaEnforcer) -> None:
    """Replace cloud and desktop executors so a new turn can be refused up front."""
    envs: tuple[EnvironmentType, ...] = ("cloud", "desktop_worker")
    for env_type in envs:
        inner_factory = service.executor_factory(env_type)
        if inner_factory is None:
            continue
        service.register_executor_factory(
            env_type,
            lambda actor, f=inner_factory: BudgetAdmissionExecutor(f(actor), actor, enforcer),
        )


__all__ = [
    "PERIODS",
    "USAGE_SQL",
    "AgentQuotaEnforcer",
    "BudgetAdmissionExecutor",
    "QuotaDecision",
    "QuotaRule",
    "utc_now",
    "window_starts",
    "wrap_executors_with_quota",
]
