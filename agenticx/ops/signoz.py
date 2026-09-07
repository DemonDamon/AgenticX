"""Optional HTTP adapter for a configured observability API.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agenticx.ops.query import (
    QueryResult,
    QueryScope,
    TraceSpan,
    clamp_limit,
    scope_is_invalid,
)


def _parse_ts(raw: object) -> datetime | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(float(raw) / (1000 if float(raw) > 1e12 else 1))
        except (OSError, ValueError, OverflowError):
            return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


class SigNozProvider:
    """Minimal HTTP reader. Failures become typed empty results, never raise."""

    def __init__(self, api_url: str = "", api_key: str = "") -> None:
        self.api_url = (api_url or "").rstrip("/")
        self.api_key = api_key or ""

    def get_trace(self, scope: QueryScope) -> QueryResult:
        if scope_is_invalid(scope):
            return QueryResult(items=[], source="signoz", reason="invalid_scope")
        if not self.api_url:
            return QueryResult(items=[], source="signoz", reason="signoz_http_0")
        trace_id = (scope.trace_id or "").strip() or (scope.session_id or "").strip()
        if not trace_id:
            return QueryResult(items=[], source="signoz", reason="invalid_scope")
        paths = [f"/api/v1/traces/{trace_id}", f"/api/v5/traces/{trace_id}"]
        last_reason = "signoz_http_0"
        for path in paths:
            result, retry = self._get_json(path)
            if result is not None:
                spans = self._map_spans(result, scope)
                if spans:
                    return QueryResult(
                        items=spans[: clamp_limit(scope.limit)],
                        source="signoz",
                        reason="",
                    )
                return QueryResult(items=[], source="signoz", reason="signoz_empty")
            last_reason = retry
            if not retry.endswith("404"):
                break
        return QueryResult(items=[], source="signoz", reason=last_reason)

    def get_logs(self, scope: QueryScope) -> QueryResult:
        if scope_is_invalid(scope):
            return QueryResult(items=[], source="signoz", reason="invalid_scope")
        return QueryResult(items=[], source="signoz", reason="signoz_logs_unsupported")

    def get_recent_changes(self, scope: QueryScope) -> QueryResult:
        return QueryResult(items=[], source="signoz", reason="not_a_change_plane")

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["SIGNOZ-API-KEY"] = self.api_key
        return headers

    def _get_json(self, path: str) -> tuple[Any | None, str]:
        url = f"{self.api_url}{path}"
        req = Request(url, headers=self._headers(), method="GET")
        try:
            with urlopen(req, timeout=3) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                body = resp.read()
        except HTTPError as exc:
            return None, f"signoz_http_{exc.code}"
        except (URLError, TimeoutError, OSError, ValueError):
            return None, "signoz_http_0"
        if status != 200:
            return None, f"signoz_http_{status}"
        try:
            return json.loads(body.decode("utf-8")), ""
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, "signoz_http_200"

    def _map_spans(self, payload: Any, scope: QueryScope) -> list[TraceSpan]:
        raw_spans = _extract_span_list(payload)
        out: list[TraceSpan] = []
        fallback_trace = (scope.trace_id or "").strip()
        session_id = (scope.session_id or "").strip()
        for item in raw_spans:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("spanName") or "span")
            span_id = str(item.get("spanId") or item.get("span_id") or "")
            trace_id = str(item.get("traceId") or item.get("trace_id") or fallback_trace)
            status = _map_status(item.get("status"))
            attrs = {"agenticx.session.id": session_id} if session_id else {}
            out.append(
                TraceSpan(
                    trace_id=trace_id,
                    span_id=span_id,
                    name=name,
                    start_ts=_parse_ts(item.get("startTime") or item.get("start_ts") or item.get("timestamp")),
                    duration_ms=_as_float(item.get("durationMs") or item.get("duration_ms")),
                    status=status,
                    attributes=attrs,
                    source="signoz",
                )
            )
        return out


def _extract_span_list(payload: Any) -> list:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    spans = payload.get("spans")
    if isinstance(spans, list):
        return spans
    data = payload.get("data")
    if isinstance(data, dict):
        inner = data.get("spans")
        if isinstance(inner, list):
            return inner
    if isinstance(data, list):
        return data
    return []


def _map_status(raw: object) -> str:
    if isinstance(raw, dict):
        code = str(raw.get("code") or raw.get("status") or "").lower()
        if "error" in code or code in {"2", "status_code_error"}:
            return "error"
        if "ok" in code or code in {"0", "1", "status_code_ok", "unset"}:
            return "ok"
        return "unknown"
    text = str(raw or "unknown").lower()
    if "error" in text:
        return "error"
    if text in {"ok", "unset", ""}:
        return "ok" if text == "ok" else "unknown"
    return text if text in {"ok", "error", "unknown"} else "unknown"


def _as_float(raw: object) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None
