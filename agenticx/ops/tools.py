"""Read-only investigation tools. On by default; disable via config or env.

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
            "description": (
                "Read-only. Fetch spans for a session_id or trace_id. Never invent spans. "
                "Includes tool rows from messages.json and tool_call_observations.json. "
                "No chat text. For health score call get_session_review."
            ),
            "parameters": _TOOL_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_logs",
            "description": (
                "Read-only. Fetch logs for a session_id or trace_id. Never invent logs. "
                "Includes observation result_summary when tool rows are missing. "
                "Call this when asking why a session failed."
            ),
            "parameters": _TOOL_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_changes",
            "description": (
                "Read-only. Fetch recent change events for a session_id. "
                "Never invent events. Not the health score."
            ),
            "parameters": _TOOL_PARAMS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_session_review",
            "description": (
                "Read-only. Compute the session health review (overall 0-100 and five "
                "dimensions) for a session_id. Same scoring as the Desktop health card. "
                "Does not write files. Never invent scores."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "additionalProperties": False,
            },
        },
    },
]

OPS_TOOL_NAMES = frozenset(
    {"get_trace", "get_logs", "get_recent_changes", "get_session_review"}
)


def ops_tools_enabled() -> bool:
    """Env overrides config. Unset env + missing config key → enabled."""
    env_raw = os.environ.get("AGENTICX_OPS_TOOLS")
    if env_raw is not None and str(env_raw).strip() != "":
        flag = str(env_raw).strip().lower()
        if flag in {"1", "true", "on", "yes"}:
            return True
        if flag in {"0", "false", "off", "no"}:
            return False
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager.get_value("ops.tools_enabled")
        if raw is None:
            return True
        if isinstance(raw, bool):
            return raw
        return str(raw).strip().lower() in {"1", "true", "on", "yes"}
    except Exception:
        return True


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


def _dispatch_session_review(arguments: dict[str, Any] | None) -> str:
    from agenticx.learning.loop_review import review_session
    from agenticx.ops.first_party import FirstPartyProvider

    session_id = str((arguments or {}).get("session_id") or "").strip()
    if not session_id:
        return json.dumps(
            {"source": "loop_review", "reason": "invalid_scope", "items": []},
            ensure_ascii=False,
        )
    session_dir = FirstPartyProvider()._session_dir(session_id)
    if not session_dir.is_dir():
        return json.dumps(
            {"source": "loop_review", "reason": "no_session", "items": []},
            ensure_ascii=False,
        )
    review = review_session(session_dir)
    return json.dumps(
        {
            "source": "loop_review",
            "reason": "",
            "items": [_json_ready(review)],
        },
        ensure_ascii=False,
    )


def dispatch_ops_tool(name: str, arguments: dict[str, Any] | None, session: Any = None) -> str:
    if name == "get_session_review":
        return _dispatch_session_review(arguments)
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
