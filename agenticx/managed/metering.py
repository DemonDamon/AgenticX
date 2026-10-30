#!/usr/bin/env python3
"""Platform metering recorder abstraction for managed / data-suite agents.

Shapes align with enterprise ``UsageRecordInput`` (TS MeteringService.recordUsage)
so Python-side patrol / NL2SQL ticks can assert usage without a live DB.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable
from uuid import uuid4


def _utc_bucket(now: datetime | None = None) -> str:
    dt = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


@dataclass
class UsageRecord:
    """One usage event; field names mirror TS UsageRecordInput + optional agent tags."""

    tenant_id: str
    provider: str
    model: str
    time_bucket: str
    cost_usd: float = 0.0
    route: str = "chat"
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    id: Optional[str] = None
    dept_id: Optional[str] = None
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id:
            self.id = str(uuid4())
        if self.total_tokens <= 0:
            self.total_tokens = int(self.input_tokens) + int(self.output_tokens)


@runtime_checkable
class MeteringRecorder(Protocol):
    def record(self, record: UsageRecord) -> UsageRecord:
        """Persist one usage record; return the stored copy (with id)."""


class InMemoryMeteringStore:
    """Hermetic recorder for unit tests and local patrol ticks."""

    def __init__(self) -> None:
        self.records: List[UsageRecord] = []

    def record(self, record: UsageRecord) -> UsageRecord:
        stored = UsageRecord(
            tenant_id=record.tenant_id,
            provider=record.provider,
            model=record.model,
            time_bucket=record.time_bucket or _utc_bucket(),
            cost_usd=float(record.cost_usd),
            route=record.route or "chat",
            input_tokens=int(record.input_tokens),
            output_tokens=int(record.output_tokens),
            total_tokens=int(record.total_tokens),
            id=record.id or str(uuid4()),
            dept_id=record.dept_id,
            user_id=record.user_id,
            agent_id=record.agent_id,
            metadata=dict(record.metadata or {}),
        )
        self.records.append(stored)
        return stored

    def by_route(self, route: str) -> List[UsageRecord]:
        return [r for r in self.records if r.route == route]


@dataclass(frozen=True)
class PatrolMeteringContext:
    tenant_id: str
    agent_id: str = "data_suite_patrol"
    provider: str = "agenticx"
    model: str = "patrol-tick"
    user_id: Optional[str] = None
    dept_id: Optional[str] = None


def record_patrol_usage(
    store: MeteringRecorder,
    *,
    tenant_id: str,
    tick_id: str,
    agent_id: str = "data_suite_patrol",
    provider: str = "agenticx",
    model: str = "patrol-tick",
    user_id: Optional[str] = None,
    dept_id: Optional[str] = None,
    webhook_count: int = 0,
    todos: int = 0,
    cost_usd: float = 0.0,
    time_bucket: Optional[str] = None,
) -> UsageRecord:
    """Record one patrol-tick usage event into the platform metering abstraction."""
    return store.record(
        UsageRecord(
            tenant_id=tenant_id,
            provider=provider,
            model=model,
            time_bucket=time_bucket or _utc_bucket(),
            cost_usd=cost_usd,
            route="patrol",
            input_tokens=0,
            output_tokens=0,
            total_tokens=max(1, int(webhook_count) + int(todos)),
            user_id=user_id,
            dept_id=dept_id,
            agent_id=agent_id,
            metadata={"tick_id": tick_id, "webhook_count": webhook_count, "todos": todos},
        )
    )


__all__ = [
    "UsageRecord",
    "MeteringRecorder",
    "InMemoryMeteringStore",
    "PatrolMeteringContext",
    "record_patrol_usage",
]
