"""TelemetryQuery factory.

Environment variables:
- AGENTICX_TELEMETRY_BACKEND: first_party | signoz | auto (default auto)
- SIGNOZ_API_URL: optional HTTP base, e.g. http://127.0.0.1:8080
- SIGNOZ_API_KEY: optional
- AGENTICX_SESSIONS_ROOT: FirstParty root (default ~/.agenticx/sessions)
- AGENTICX_AUDIT_JSONL: optional audit JSONL path

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path

from agenticx.ops.first_party import FirstPartyProvider
from agenticx.ops.query import QueryResult, QueryScope, TelemetryQuery
from agenticx.ops.signoz import SigNozProvider


class CompositeTelemetryQuery:
    """Prefer remote HTTP results; fall back to FirstParty when empty."""

    def __init__(
        self,
        first_party: FirstPartyProvider,
        signoz: SigNozProvider | None = None,
    ) -> None:
        self.first_party = first_party
        self.signoz = signoz

    def get_trace(self, scope: QueryScope) -> QueryResult:
        if self.signoz is None:
            return self.first_party.get_trace(scope)
        primary = self.signoz.get_trace(scope)
        if primary.items:
            return primary
        fallback = self.first_party.get_trace(scope)
        if fallback.items:
            fallback.reason = fallback.reason or "signoz_empty_used_first_party"
            return fallback
        return primary if primary.reason else fallback

    def get_logs(self, scope: QueryScope) -> QueryResult:
        if self.signoz is None:
            return self.first_party.get_logs(scope)
        primary = self.signoz.get_logs(scope)
        if primary.items:
            return primary
        fallback = self.first_party.get_logs(scope)
        if fallback.items:
            fallback.reason = fallback.reason or "signoz_empty_used_first_party"
            return fallback
        return primary if primary.reason else fallback

    def get_recent_changes(self, scope: QueryScope) -> QueryResult:
        return self.first_party.get_recent_changes(scope)


def get_telemetry_query() -> TelemetryQuery:
    backend = os.environ.get("AGENTICX_TELEMETRY_BACKEND", "auto").strip().lower() or "auto"
    sessions_root_raw = os.environ.get("AGENTICX_SESSIONS_ROOT", "").strip()
    sessions_root = (
        Path(sessions_root_raw) if sessions_root_raw else Path.home() / ".agenticx" / "sessions"
    )
    audit_raw = os.environ.get("AGENTICX_AUDIT_JSONL", "").strip()
    first_party = FirstPartyProvider(
        sessions_root=sessions_root,
        audit_jsonl=Path(audit_raw) if audit_raw else None,
    )
    api_url = os.environ.get("SIGNOZ_API_URL", "").strip()
    api_key = os.environ.get("SIGNOZ_API_KEY", "").strip()
    if backend == "first_party":
        return first_party
    if backend == "signoz":
        return CompositeTelemetryQuery(
            first_party=first_party,
            signoz=SigNozProvider(api_url=api_url, api_key=api_key),
        )
    if api_url:
        return CompositeTelemetryQuery(
            first_party=first_party,
            signoz=SigNozProvider(api_url=api_url, api_key=api_key),
        )
    return first_party
