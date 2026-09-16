#!/usr/bin/env python3
"""Deterministic Markdown and JSON replay exports.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from agenticx.runtime.replay_ledger.contracts import ReplayRunRecord, RunEvent

_SECRET_KEY = re.compile(
    r"(?:api_key|apikey|authorization|token|secret|password|cookie)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_SECRET_TEXT_VALUE = re.compile(
    r"""(?ix)
    (
        ["']?(?:api_key|apikey|authorization|token|secret|password|cookie)["']?
        \s*[:=]\s*
    )
    [^,\r\n]*
    """
)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, tuple):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            parsed = None
        if isinstance(parsed, (dict, list)):
            return json.dumps(
                _redact(parsed),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        redacted = _SECRET_TEXT_VALUE.sub(
            lambda match: f"{match.group(1)}[REDACTED]",
            value,
        )
        return _BEARER.sub("Bearer [REDACTED]", redacted)
    return value


def _resolved_event(
    event: RunEvent,
    resolve_payload: Callable[[str], Any | None],
    *,
    redact: bool,
) -> dict[str, Any]:
    row = event.to_dict()
    if event.payload_ref:
        resolved = resolve_payload(event.payload_ref)
        if resolved is not None:
            row["resolved_payload"] = resolved
    return _redact(row) if redact else row


def export_run_json(
    record: ReplayRunRecord,
    events: list[RunEvent],
    *,
    resolve_payload: Callable[[str], Any | None],
    redact: bool = True,
) -> str:
    """Export canonical JSON with stable key and event ordering."""
    ordered = sorted(events, key=lambda item: (item.seq, item.event_id))
    value = {
        "run": _redact(record.to_dict()) if redact else record.to_dict(),
        "events": [
            _resolved_event(event, resolve_payload, redact=redact) for event in ordered
        ],
    }
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _summary(row: dict[str, Any]) -> str:
    payload = row.get("resolved_payload", row.get("payload", {}))
    if not isinstance(payload, dict):
        return str(payload)
    for key in ("text", "summary", "result", "status", "name"):
        value = payload.get(key)
        if value not in (None, ""):
            return str(value).replace("\n", " ")[:500]
    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )[:500]


def _tool_arguments_summary(row: dict[str, Any], *, redact: bool) -> str:
    resolved = row.get("resolved_payload")
    if isinstance(resolved, dict) and "arguments" in resolved:
        return json.dumps(
            resolved["arguments"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    payload = row.get("payload")
    if isinstance(payload, dict) and "arguments" in payload:
        arguments = _redact(payload["arguments"]) if redact else payload["arguments"]
        return json.dumps(
            arguments,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    summary = payload.get("arguments_summary") if isinstance(payload, dict) else None
    if not isinstance(summary, str) or not summary:
        return "unknown"
    if not redact:
        return summary
    try:
        parsed = json.loads(summary)
    except (TypeError, ValueError):
        return summary
    return json.dumps(
        _redact(parsed),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _tool_name(row: dict[str, Any]) -> str:
    for payload_key in ("resolved_payload", "payload"):
        payload = row.get(payload_key)
        if isinstance(payload, dict):
            name = str(payload.get("name") or payload.get("tool_name") or "").strip()
            if name:
                return name
    return "unknown"


def _tool_result_status(row: dict[str, Any] | None) -> str:
    if row is None:
        return "unknown"
    payload = row.get("payload")
    if not isinstance(payload, dict):
        return "unknown"
    status = str(payload.get("status") or "").strip().lower()
    if status in {"completed", "error", "cancelled"}:
        return status
    return "unknown"


def export_run_markdown(
    record: ReplayRunRecord,
    events: list[RunEvent],
    *,
    resolve_payload: Callable[[str], Any | None],
    redact: bool = True,
) -> str:
    """Export a stable human-readable replay report."""
    ordered = sorted(events, key=lambda item: (item.seq, item.event_id))
    rows = [_resolved_event(event, resolve_payload, redact=redact) for event in ordered]
    user_rows = [row for row in rows if row["type"] == "user_message"]
    final_rows = [row for row in rows if row["type"] == "assistant_output_completed"]
    tool_rows = [row for row in rows if row["type"] in {"tool_call", "tool_result"}]
    confirm_rows = [
        row
        for row in rows
        if row["type"].startswith("confirm_")
        or row["type"].startswith("clarification_")
    ]
    error_rows = [
        row for row in rows if row["type"] in {"error", "ledger_gap", "stall"}
    ]
    artifact_rows = [row for row in rows if row["type"] == "artifact"]

    lines = [
        f"# Replay Run {record.run_id}",
        "",
        "## Run metadata",
        f"- Session: `{record.session_id}`",
        f"- Turn: `{record.turn_id}`",
        f"- Agent: `{record.agent_id}`",
        f"- Status: `{record.status}`",
        f"- Completeness: `{record.completeness}`",
        f"- Provider: `{record.provider or ''}`",
        f"- Model: `{record.model or ''}`",
        "",
        "## Original instruction",
        _summary(user_rows[0]) if user_rows else "_Unavailable_",
        "",
        "## Outcome",
        _summary(final_rows[-1]) if final_rows else "_Unavailable_",
        "",
        "## Timeline",
    ]
    for row in rows:
        relative = float(row["ts"]) - float(record.created_at)
        lines.append(
            f"- {int(row['seq']):04d} | +{relative:.3f}s | {row['agent_id']} | "
            f"{row['type']} | {_summary(row)}"
        )

    lines.extend(["", "## Tool calls"])
    result_by_call_id = {
        str(row.get("tool_call_id") or ""): row
        for row in tool_rows
        if row["type"] == "tool_result" and row.get("tool_call_id")
    }
    paired_result_ids: set[str] = set()
    for row in (item for item in tool_rows if item["type"] == "tool_call"):
        tool_call_id = str(row.get("tool_call_id") or "")
        result = result_by_call_id.get(tool_call_id)
        duration = "unknown"
        if result is not None:
            duration = f"{max(0.0, float(result['ts']) - float(row['ts'])):.3f}s"
            paired_result_ids.add(str(result["event_id"]))
        sequence_and_duration = (
            f"- {int(row['seq']):04d} `{tool_call_id or 'unknown'}`"
            f" | Duration: {duration} | "
        )
        lines.append(
            sequence_and_duration
            + f"Tool: `{_tool_name(row)}` | "
            + f"Arguments: `{_tool_arguments_summary(row, redact=redact)}` | "
            + f"Status: `{_tool_result_status(result)}`"
        )
    for row in (
        item
        for item in tool_rows
        if item["type"] == "tool_result"
        and str(item["event_id"]) not in paired_result_ids
    ):
        tool_call_id = str(row.get("tool_call_id") or "unknown")
        lines.append(
            f"- {int(row['seq']):04d} `{tool_call_id}` | Duration: unknown | "
            f"Tool: `{_tool_name(row)}` | Arguments: `unknown` | "
            f"Status: `{_tool_result_status(row)}`"
        )

    lines.extend(["", "## Confirmations / clarifications"])
    lines.extend(f"- {row['type']}: {_summary(row)}" for row in confirm_rows)
    lines.extend(["", "## Errors / gaps"])
    if record.completeness == "partial":
        lines.append(f"- 记录不完整: {record.gap_reason or 'unknown_gap'}")
    lines.extend(f"- {row['type']}: {_summary(row)}" for row in error_rows)
    lines.extend(["", "## Artifacts"])
    lines.extend(f"- {_summary(row)}" for row in artifact_rows)
    forked_from_seq = (
        record.forked_from_seq if record.forked_from_seq is not None else ""
    )
    lines.extend(
        [
            "",
            "## Branch lineage",
            f"- Parent run: `{record.parent_run_id or ''}`",
            f"- Forked from event: `{record.forked_from_event_id or ''}`",
            f"- Forked from seq: `{forked_from_seq}`",
            "",
        ]
    )
    return "\n".join(lines)
