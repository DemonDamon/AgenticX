#!/usr/bin/env python3
"""Pending Claude Code can_use_tool control_request queue helpers.

When ``auto_allow`` is off, the bridge must surface permission prompts to Near
instead of silently dropping ``control_request`` lines (which hangs the CLI).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

_LOW_RISK_TOOLS = frozenset(
    {
        "read",
        "glob",
        "grep",
        "ls",
        "list",
        "search",
        "find",
        "notebookread",
        "todoread",
        "todowrite",  # session-local checklist; low blast radius
    }
)

_PROTECTED_PREFIXES = (
    "bash",
    "write",
    "edit",
    "multiedit",
    "notebookedit",
    "websearch",
    "webfetch",
    "mcp__",
    "task",
    "agent",
    "computer",
)

_MAX_SUMMARY_CHARS = 120
_MAX_SUMMARY_KEYS = 8


@dataclass
class PendingPermission:
    """One unanswered headless ``can_use_tool`` prompt."""

    request_id: str
    tool_name: str
    display_name: str
    tool_use_id: str
    tool_input: Dict[str, Any] = field(default_factory=dict)
    input_summary: Dict[str, Any] = field(default_factory=dict)
    risk: str = "protected"
    emitted: bool = False

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "tool_name": self.tool_name,
            "display_name": self.display_name,
            "tool_use_id": self.tool_use_id,
            "input_summary": dict(self.input_summary),
            "risk": self.risk,
        }


def classify_cc_tool_risk(tool_name: str) -> str:
    """Return ``low`` or ``protected`` for Near confirm-strategy mapping."""
    name = str(tool_name or "").strip()
    if not name:
        return "protected"
    lower = name.lower()
    base = lower.rsplit("__", 1)[-1] if "__" in lower else lower
    # Strip common MCP / namespace noise for base match.
    simple = base.split(".")[-1]
    if simple in _LOW_RISK_TOOLS or lower in _LOW_RISK_TOOLS:
        return "low"
    for prefix in _PROTECTED_PREFIXES:
        if lower.startswith(prefix) or simple.startswith(prefix):
            return "protected"
    # Unknown tools stay protected (fail-closed).
    return "protected"


def summarize_tool_input(tool_input: Any) -> Dict[str, Any]:
    """Compact input for UI/confirm context — never dump huge tool args."""
    if not isinstance(tool_input, dict):
        return {}
    out: Dict[str, Any] = {}
    for idx, (key, value) in enumerate(tool_input.items()):
        if idx >= _MAX_SUMMARY_KEYS:
            out["…"] = f"+{len(tool_input) - _MAX_SUMMARY_KEYS} keys"
            break
        k = str(key)
        if isinstance(value, str):
            text = value
            if len(text) > _MAX_SUMMARY_CHARS:
                text = text[: _MAX_SUMMARY_CHARS - 1] + "…"
            out[k] = text
        elif isinstance(value, (int, float, bool)) or value is None:
            out[k] = value
        elif isinstance(value, list):
            out[k] = f"[{len(value)} items]"
        elif isinstance(value, dict):
            out[k] = f"{{{len(value)} keys}}"
        else:
            text = str(value)
            if len(text) > _MAX_SUMMARY_CHARS:
                text = text[: _MAX_SUMMARY_CHARS - 1] + "…"
            out[k] = text
    return out


def pending_permission_from_control_request(
    req: Dict[str, Any],
) -> Optional[PendingPermission]:
    """Build a :class:`PendingPermission` from a parsed control_request object."""
    request_id = str(req.get("request_id") or "").strip()
    inner = req.get("request")
    if not request_id or not isinstance(inner, dict):
        return None
    tool_name = str(inner.get("tool_name") or "").strip() or "tool"
    display_name = str(inner.get("display_name") or "").strip() or tool_name
    tool_use_id = str(inner.get("tool_use_id") or "").strip()
    raw_input = inner.get("input")
    tool_input = dict(raw_input) if isinstance(raw_input, dict) else {}
    return PendingPermission(
        request_id=request_id,
        tool_name=tool_name,
        display_name=display_name,
        tool_use_id=tool_use_id,
        tool_input=tool_input,
        input_summary=summarize_tool_input(tool_input),
        risk=classify_cc_tool_risk(tool_name),
    )


__all__ = [
    "PendingPermission",
    "classify_cc_tool_risk",
    "pending_permission_from_control_request",
    "summarize_tool_input",
]
