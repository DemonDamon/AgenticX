#!/usr/bin/env python3
"""NDJSON turn-semantics helpers for the local CodeBuddy (WB) bridge.

These helpers decide when a turn ends and how it ended, and pull usage /
activity out of raw stream-json stdout lines. They are WB-specific and never
import the Claude Code bridge.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import ujson

_USAGE_KEYS: Tuple[str, ...] = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def parse_stream_line(line: str) -> Optional[Dict[str, Any]]:
    """Parse one NDJSON stdout line; return dict or None when not a JSON object."""
    line = (line or "").strip()
    if not line:
        return None
    try:
        obj = ujson.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def line_is_turn_terminal(line: str) -> bool:
    """True for any ``type == "result"`` line, regardless of subtype.

    Intentionally wider than the Claude Code bridge's success-only heuristic:
    a turn that was blocked or errored still ends the turn.
    """
    obj = parse_stream_line(line)
    if obj is None:
        return False
    return obj.get("type") == "result"


def classify_result(obj: Optional[Dict[str, Any]]) -> Tuple[str, str]:
    """Return ``(kind, detail)`` where kind is "success" | "blocked" | "error"."""
    if not isinstance(obj, dict):
        return ("error", "unparseable result")

    denials = obj.get("permission_denials")
    if isinstance(denials, list) and len(denials) > 0:
        names: list[str] = []
        for item in denials:
            if isinstance(item, dict):
                names.append(str(item.get("tool_name") or item))
            else:
                names.append(str(item))
        return ("blocked", ",".join(names)[:200])

    subtype = obj.get("subtype")
    if obj.get("is_error"):
        return ("error", str(subtype or "is_error"))
    if subtype != "success":
        return ("error", str(subtype or "missing subtype"))
    return ("success", "")


def extract_usage(obj: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """Pull the four token counters out of a result object (missing -> 0)."""
    out: Dict[str, int] = {k: 0 for k in _USAGE_KEYS}
    if not isinstance(obj, dict):
        return out
    usage = obj.get("usage")
    if not isinstance(usage, dict):
        return out
    for key in _USAGE_KEYS:
        raw = usage.get(key)
        try:
            out[key] = int(raw) if raw is not None else 0
        except (ValueError, TypeError):
            out[key] = 0
    return out


def extract_result_text(obj: Optional[Dict[str, Any]]) -> str:
    """Return ``str(obj["result"])`` or "" when absent / None."""
    if not isinstance(obj, dict):
        return ""
    result = obj.get("result")
    if result is None:
        return ""
    return str(result)


def extract_tool_activity(line: str) -> Optional[str]:
    """Best-effort current-activity label from an assistant line.

    Scans ``obj["message"]["content"]`` for items with ``type == "tool_use"``
    and returns the LAST such item's ``name``. Returns None when the shape
    does not match. Heuristic by design.
    """
    obj = parse_stream_line(line)
    if obj is None:
        return None
    message = obj.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if not isinstance(content, list):
        return None
    last_name: Optional[str] = None
    for item in content:
        if isinstance(item, dict) and item.get("type") == "tool_use":
            name = item.get("name")
            if name:
                last_name = str(name)
    return last_name


_WRITE_PATH_TOOLS = frozenset({"Write", "Edit"})


def extract_written_paths(line: str) -> list[str]:
    """Absolute paths from Write/Edit tool_use input. Empty when shape mismatches."""
    obj = parse_stream_line(line)
    if obj is None:
        return []
    message = obj.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    out: list[str] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        if str(item.get("name") or "") not in _WRITE_PATH_TOOLS:
            continue
        inp = item.get("input")
        if not isinstance(inp, dict):
            continue
        raw = inp.get("file_path") or inp.get("path")
        path = str(raw or "").strip()
        if path.startswith("/") or (len(path) >= 3 and path[1] == ":" and path[0].isalpha()):
            out.append(path)
    return out
