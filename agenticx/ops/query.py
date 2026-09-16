"""Frozen TelemetryQuery types and helpers.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

_OTEL_W3C = re.compile(r"[0-9a-fA-F]{32}")
_GATEWAY_ULID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")


@dataclass
class QueryScope:
    session_id: str = ""
    tenant_id: str = ""
    deployment_id: str = ""
    trace_id: str = ""
    start_ts: datetime | None = None
    end_ts: datetime | None = None
    limit: int = 50


@dataclass
class TraceSpan:
    trace_id: str
    span_id: str
    name: str
    start_ts: datetime | None
    duration_ms: float | None
    status: str
    attributes: dict[str, str]
    source: str


@dataclass
class LogRecord:
    ts: datetime | None
    level: str
    message: str
    trace_id: str
    session_id: str
    source: str


@dataclass
class ChangeEvent:
    ts: datetime | None
    deployment_id: str
    action: str
    summary: str
    source: str


@dataclass
class QueryResult:
    items: list = field(default_factory=list)
    source: str = ""
    reason: str = ""


class TelemetryQuery(Protocol):
    def get_trace(self, scope: QueryScope) -> QueryResult: ...

    def get_logs(self, scope: QueryScope) -> QueryResult: ...

    def get_recent_changes(self, scope: QueryScope) -> QueryResult: ...


def classify_trace_id(value: str) -> str:
    v = (value or "").strip()
    if _OTEL_W3C.fullmatch(v):
        return "otel_w3c"
    if _GATEWAY_ULID.fullmatch(v):
        return "gateway_ulid"
    return "unknown"


def clamp_limit(limit: int, default: int = 50) -> int:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = default
    return max(1, min(200, n))


def scope_is_invalid(scope: QueryScope) -> bool:
    """Empty scope or unknown-only trace_id without session_id is invalid."""
    session_id = (scope.session_id or "").strip()
    tenant_id = (scope.tenant_id or "").strip()
    deployment_id = (scope.deployment_id or "").strip()
    trace_id = (scope.trace_id or "").strip()
    if session_id or tenant_id or deployment_id or scope.start_ts or scope.end_ts:
        return False
    if trace_id and classify_trace_id(trace_id) != "unknown":
        return False
    return True
