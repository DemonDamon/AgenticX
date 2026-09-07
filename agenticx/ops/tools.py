"""Read-only investigation tools. Off by default.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, is_dataclass
from datetime import datetime
from typing import Any

from agenticx.ops.factory import get_telemetry_query
from agenticx.ops.query import QueryScope, clamp_limit

_TOOL_PARAMS = {
    "type": "object",
    "properties": {
        "session_id": {"type": "string"},
        "trace_id": {"type": "string"},
        "tenant_id": {"type": "string"},
        "deployment_id": {"type": "string"},
        "limit": {"type": "integer"},
    },
    "additionalProperties": False,
}

OPS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_trace",
            "description": "Read-only. Fetch spans for a session_id or trace_id. Never invent spans.",
            "parameters": _TOOL_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_logs",
            "description": "Read-only. Fetch logs for a session_id or trace_id. Never invent logs.",
            "parameters": _TOOL_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_changes",
            "description": "Read-only. Fetch recent change events for a session_id. Never invent events.",
            "parameters": _TOOL_PARAMS,
        },
    },
]

OPS_TOOL_NAMES = frozenset({"get_trace", "get_logs", "get_recent_changes"})


def ops_tools_enabled() -> bool:
    raw = os.environ.get("AGENTICX_OPS_TOOLS", "").strip().lower()
    return raw in {"1", "true", "on"}


def merge_ops_tools_into(tool_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not ops_tools_enabled():
        return tool_list
    seen: set[str] = set()
    for t in tool_list:
        if not isinstance(t, dict):
            continue
        fn = t.get("function", {})
        if isinstance(fn, dict):
            n = str(fn.get("name", "") or "").strip()
            if n:
                seen.add(n)
    out = list(tool_list)
    for spec in OPS_TOOLS:
        fn = spec.get("function", {})
        name = str(fn.get("name", "") or "").strip()
        if not name or name in seen:
            continue
        out.append(spec)
        seen.add(name)
    return out


def _json_ready(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return {k: _json_ready(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {k: _json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_ready(v) for v in value]
    return value


def _scope_from_args(arguments: dict[str, Any] | None) -> QueryScope:
    args = arguments or {}
    limit_raw = args.get("limit", 50)
    try:
        limit = clamp_limit(int(limit_raw))
    except (TypeError, ValueError):
        limit = 50
    return QueryScope(
        session_id=str(args.get("session_id") or "").strip(),
        tenant_id=str(args.get("tenant_id") or "").strip(),
        deployment_id=str(args.get("deployment_id") or "").strip(),
        trace_id=str(args.get("trace_id") or "").strip(),
        limit=limit,
    )


def dispatch_ops_tool(name: str, arguments: dict[str, Any] | None, session: Any = None) -> str:
    query = get_telemetry_query()
    scope = _scope_from_args(arguments)
    if name == "get_trace":
        result = query.get_trace(scope)
    elif name == "get_logs":
        result = query.get_logs(scope)
    elif name == "get_recent_changes":
        result = query.get_recent_changes(scope)
    else:
        return json.dumps(
            {"source": "", "reason": "unknown_ops_tool", "items": []},
            ensure_ascii=False,
        )
    return json.dumps(
        {
            "source": result.source,
            "reason": result.reason,
            "items": _json_ready(result.items),
        },
        ensure_ascii=False,
    )
