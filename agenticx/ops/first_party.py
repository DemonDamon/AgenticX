"""First-party TelemetryQuery over messages.json and optional audit JSONL.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from agenticx.ops.change_log import read_change_events, read_ops_change_events
from agenticx.ops.query import (
    LogRecord,
    QueryResult,
    QueryScope,
    TraceSpan,
    clamp_limit,
    scope_is_invalid,
)

_LOG_MARKERS = ("error", "ERROR", "失败")
_MAX_LOG_BYTES = 4096


def _parse_ts(raw: object) -> datetime | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        try:
            value = float(raw)
            if value > 1e12:
                value /= 1000.0
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    text = str(raw).strip()
    if text.isdigit():
        return _parse_ts(int(text))
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _tool_row_status(content: str, tool_status: str) -> str:
    if content.startswith("ERROR") or content.startswith("Error"):
        return "error"
    status = (tool_status or "").strip().lower()
    if status in {"error", "failed", "fail"}:
        return "error"
    if status in {"done", "ok", "success"}:
        return "ok"
    if content:
        return "ok"
    return "unknown"


def _truncate_4kib(text: str) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= _MAX_LOG_BYTES:
        return text
    return encoded[:_MAX_LOG_BYTES].decode("utf-8", errors="ignore")


def _synthetic_trace_id(scope: QueryScope) -> str:
    if (scope.trace_id or "").strip():
        return scope.trace_id.strip()
    sid = (scope.session_id or "").strip()
    return f"session:{sid}" if sid else ""


def _near_ts(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return False
    return abs((left - right).total_seconds()) <= 2.0


class FirstPartyProvider:
    """Read local session evidence. Never invent W3C 32-hex trace ids."""

    def __init__(
        self,
        sessions_root: Path | None = None,
        audit_jsonl: Path | None = None,
    ) -> None:
        if sessions_root is not None:
            self.sessions_root = Path(sessions_root)
        else:
            env_root = os.environ.get("AGENTICX_SESSIONS_ROOT", "").strip()
            self.sessions_root = (
                Path(env_root) if env_root else Path.home() / ".agenticx" / "sessions"
            )
        if audit_jsonl is not None:
            self.audit_jsonl = Path(audit_jsonl)
        else:
            env_audit = os.environ.get("AGENTICX_AUDIT_JSONL", "").strip()
            self.audit_jsonl = Path(env_audit) if env_audit else None

    def _session_dir(self, session_id: str) -> Path:
        return self.sessions_root / session_id

    def _load_messages(self, session_id: str) -> list[dict] | None:
        path = self._session_dir(session_id) / "messages.json"
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, list):
            return None
        return [m for m in data if isinstance(m, dict)]

    def get_trace(self, scope: QueryScope) -> QueryResult:
        if scope_is_invalid(scope):
            return QueryResult(items=[], source="first_party", reason="invalid_scope")
        session_id = (scope.session_id or "").strip()
        if not session_id:
            return QueryResult(items=[], source="first_party", reason="no_messages")
        messages = self._load_messages(session_id)
        if messages is None:
            return QueryResult(items=[], source="first_party", reason="no_messages")
        spans = self._spans_from_messages(messages, scope)
        existing_tool = [(s.name, s.start_ts) for s in spans if s.name != "assistant.reply"]
        for span in self._spans_from_observations(self._observation_records(session_id), scope):
            if any(
                name == span.name and _near_ts(ts, span.start_ts)
                for name, ts in existing_tool
            ):
                continue
            spans.append(span)
        limit = clamp_limit(scope.limit)
        return QueryResult(items=spans[:limit], source="first_party", reason="")

    def get_logs(self, scope: QueryScope) -> QueryResult:
        if scope_is_invalid(scope):
            return QueryResult(items=[], source="first_party", reason="invalid_scope")
        session_id = (scope.session_id or "").strip()
        records: list[LogRecord] = []
        existing_tool: list[tuple[str, datetime | None]] = []
        if session_id:
            messages = self._load_messages(session_id)
            if messages is None:
                return QueryResult(items=[], source="first_party", reason="no_messages")
            records.extend(self._logs_from_messages(messages, scope))
            existing_tool = [
                (s.name, s.start_ts)
                for s in self._spans_from_messages(messages, scope)
                if s.name != "assistant.reply"
            ]
            for name, rec in self._logs_from_observations(
                self._observation_records(session_id), scope
            ):
                if any(n == name and _near_ts(ts, rec.ts) for n, ts in existing_tool):
                    continue
                records.append(rec)
        records.extend(self._logs_from_audit(scope))
        limit = clamp_limit(scope.limit)
        trimmed = records[:limit]
        if not trimmed:
            return QueryResult(
                items=[],
                source="first_party",
                reason="no_logs" if session_id else "no_messages",
            )
        return QueryResult(items=trimmed, source="first_party", reason="")

    def get_recent_changes(self, scope: QueryScope) -> QueryResult:
        if scope_is_invalid(scope):
            return QueryResult(items=[], source="first_party", reason="invalid_scope")
        session_id = (scope.session_id or "").strip()
        deployment_id = (scope.deployment_id or "").strip()
        if session_id:
            events = read_change_events(self._session_dir(session_id), scope.limit)
            if not events:
                return QueryResult(items=[], source="first_party", reason="no_change_events")
            return QueryResult(items=events, source="first_party", reason="")
        if deployment_id:
            events = read_ops_change_events(deployment_id=deployment_id, limit=scope.limit)
            if not events:
                return QueryResult(items=[], source="first_party", reason="no_change_events")
            return QueryResult(items=events, source="first_party", reason="")
        return QueryResult(items=[], source="first_party", reason="no_change_events")

    def _spans_from_messages(self, messages: list[dict], scope: QueryScope) -> list[TraceSpan]:
        session_id = (scope.session_id or "").strip()
        trace_id = _synthetic_trace_id(scope)
        attrs = {"agenticx.session.id": session_id}
        spans: list[TraceSpan] = []
        by_id: dict[str, TraceSpan] = {}
        for index, msg in enumerate(messages):
            role = str(msg.get("role") or "")
            if role == "assistant":
                tool_calls = msg.get("tool_calls") or []
                if isinstance(tool_calls, list) and tool_calls:
                    for tc in tool_calls:
                        if not isinstance(tc, dict):
                            continue
                        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                        name = str((fn or {}).get("name") or "tool")
                        span_id = str(tc.get("id") or f"tc-{index}-{len(spans)}")
                        span = TraceSpan(
                            trace_id=trace_id,
                            span_id=span_id,
                            name=name,
                            start_ts=_parse_ts(msg.get("timestamp")),
                            duration_ms=None,
                            status="unknown",
                            attributes=dict(attrs),
                            source="first_party",
                        )
                        spans.append(span)
                        by_id[span_id] = span
                    continue
                content = str(msg.get("content") or "").strip()
                if content:
                    spans.append(
                        TraceSpan(
                            trace_id=trace_id,
                            span_id=str(index),
                            name="assistant.reply",
                            start_ts=_parse_ts(msg.get("timestamp")),
                            duration_ms=None,
                            status="ok",
                            attributes=dict(attrs),
                            source="first_party",
                        )
                    )
                continue
            if role != "tool":
                continue
            tool_call_id = str(msg.get("tool_call_id") or "")
            content = str(msg.get("content") or "")
            name = str(msg.get("tool_name") or msg.get("name") or "tool").strip() or "tool"
            status = _tool_row_status(content, str(msg.get("tool_status") or ""))
            span = by_id.get(tool_call_id) if tool_call_id else None
            if span is None:
                span_id = tool_call_id or f"tool-{index}"
                span = TraceSpan(
                    trace_id=trace_id,
                    span_id=span_id,
                    name=name,
                    start_ts=_parse_ts(msg.get("timestamp")),
                    duration_ms=None,
                    status=status,
                    attributes=dict(attrs),
                    source="first_party",
                )
                spans.append(span)
                if tool_call_id:
                    by_id[tool_call_id] = span
                continue
            span.status = status
            if not span.name or span.name == "tool":
                span.name = name
        return spans

    def _observation_records(self, session_id: str) -> list[dict]:
        from agenticx.learning.analyzer import load_session_observations

        return [
            row
            for row in load_session_observations(self._session_dir(session_id))
            if isinstance(row, dict)
        ]

    def _spans_from_observations(
        self, observations: list[dict], scope: QueryScope
    ) -> list[TraceSpan]:
        session_id = (scope.session_id or "").strip()
        trace_id = _synthetic_trace_id(scope)
        spans: list[TraceSpan] = []
        for index, row in enumerate(observations):
            name = str(row.get("tool_name") or "").strip() or "tool"
            turn = row.get("turn_index")
            span_id = f"obs-{turn if turn is not None else index}-{name}"
            success = row.get("success")
            spans.append(
                TraceSpan(
                    trace_id=trace_id,
                    span_id=span_id,
                    name=name,
                    start_ts=_parse_ts(row.get("timestamp")),
                    duration_ms=None,
                    status="error" if success is False else "ok",
                    attributes={
                        "agenticx.session.id": session_id,
                        "agenticx.evidence.source": "observations",
                    },
                    source="first_party",
                )
            )
        return spans

    def _logs_from_observations(
        self, observations: list[dict], scope: QueryScope
    ) -> list[tuple[str, LogRecord]]:
        session_id = (scope.session_id or "").strip()
        trace_id = _synthetic_trace_id(scope)
        records: list[tuple[str, LogRecord]] = []
        for row in observations:
            name = str(row.get("tool_name") or "").strip() or "tool"
            summary = str(row.get("result_summary") or "")
            if not summary:
                continue
            failed = row.get("success") is False or summary.startswith("ERROR") or summary.startswith("Error")
            records.append(
                (
                    name,
                    LogRecord(
                        ts=_parse_ts(row.get("timestamp")),
                        level="error" if failed else "info",
                        message=_truncate_4kib(summary),
                        trace_id=trace_id,
                        session_id=session_id,
                        source="first_party",
                    ),
                )
            )
        return records

    def _logs_from_messages(self, messages: list[dict], scope: QueryScope) -> list[LogRecord]:
        session_id = (scope.session_id or "").strip()
        trace_id = _synthetic_trace_id(scope)
        records: list[LogRecord] = []
        for msg in messages:
            role = str(msg.get("role") or "")
            content = str(msg.get("content") or "")
            ts = _parse_ts(msg.get("timestamp"))
            if role == "tool" and content:
                records.append(
                    LogRecord(
                        ts=ts,
                        level="error" if content.startswith("ERROR") or content.startswith("Error") else "info",
                        message=_truncate_4kib(content),
                        trace_id=trace_id,
                        session_id=session_id,
                        source="first_party",
                    )
                )
                continue
            if role == "assistant" and content and any(m in content for m in _LOG_MARKERS):
                records.append(
                    LogRecord(
                        ts=ts,
                        level="error",
                        message=_truncate_4kib(content),
                        trace_id=trace_id,
                        session_id=session_id,
                        source="first_party",
                    )
                )
        return records

    def _logs_from_audit(self, scope: QueryScope) -> list[LogRecord]:
        path = self.audit_jsonl
        if path is None or not path.is_file():
            return []
        session_id = (scope.session_id or "").strip()
        trace_id = (scope.trace_id or "").strip()
        records: list[LogRecord] = []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        for line in lines:
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            row_session = str(obj.get("session_id") or "")
            row_trace = str(obj.get("trace_id") or "")
            if session_id and row_session != session_id:
                if not (trace_id and row_trace == trace_id):
                    continue
            elif trace_id and not session_id and row_trace != trace_id:
                continue
            elif not session_id and not trace_id:
                continue
            parts = [
                str(obj.get("event_type") or ""),
                str(obj.get("model") or ""),
                str(obj.get("route") or ""),
            ]
            message = " ".join(p for p in parts if p).strip() or raw
            records.append(
                LogRecord(
                    ts=_parse_ts(obj.get("ts") or obj.get("timestamp")),
                    level=str(obj.get("level") or "info"),
                    message=_truncate_4kib(message),
                    trace_id=row_trace or _synthetic_trace_id(scope),
                    session_id=row_session or session_id,
                    source="first_party",
                )
            )
        return records
