#!/usr/bin/env python3
"""NDJSON helpers for Claude Code stream-json stdio (local bridge).

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import ujson


def build_user_message_line(text: str) -> str:
    """One stdin line: SDK user message wrapping plain text content."""
    payload = {
        "type": "user",
        "session_id": "",
        "message": {"role": "user", "content": text},
        "parent_tool_use_id": None,
    }
    return ujson.dumps(payload, ensure_ascii=False) + "\n"


def parse_control_request(line: str) -> Optional[Dict[str, Any]]:
    """If line is a can_use_tool control_request, return the full object; else None."""
    line = line.strip()
    if not line:
        return None
    try:
        obj = ujson.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    if obj.get("type") != "control_request":
        return None
    req = obj.get("request")
    if not isinstance(req, dict):
        return None
    if req.get("subtype") != "can_use_tool":
        return None
    return obj


def build_control_response_allow(
    request_id: str,
    tool_input: Dict[str, Any],
    tool_use_id: Optional[str] = None,
) -> str:
    """Stdin line: allow decision for permission prompt tool schema."""
    inner: Dict[str, Any] = {
        "behavior": "allow",
        "updatedInput": dict(tool_input),
    }
    if tool_use_id:
        inner["toolUseID"] = tool_use_id
    payload = {
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": inner,
        },
    }
    return ujson.dumps(payload, ensure_ascii=False) + "\n"


def build_control_response_deny(
    request_id: str,
    message: str,
    tool_use_id: Optional[str] = None,
) -> str:
    """Stdin line: deny decision."""
    inner: Dict[str, Any] = {"behavior": "deny", "message": message}
    if tool_use_id:
        inner["toolUseID"] = tool_use_id
    payload = {
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": inner,
        },
    }
    return ujson.dumps(payload, ensure_ascii=False) + "\n"


def line_looks_like_result_success(line: str) -> bool:
    """Heuristic: stream-json result line indicating completed turn."""
    line = line.strip()
    if not line:
        return False
    try:
        obj = ujson.loads(line)
    except (ValueError, TypeError):
        return False
    if not isinstance(obj, dict):
        return False
    return obj.get("type") == "result" and obj.get("subtype") == "success"
