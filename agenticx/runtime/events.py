#!/usr/bin/env python3
"""Runtime event protocol for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict


def normalize_tool_sse_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure tool_* SSE payloads expose both ``tool_call_id`` and ``id`` when either is set.

    Desktop and adapters may read either key; mirror both for backward compatibility (P1-T1).
    """
    out = dict(data)
    tid = str(out.get("tool_call_id") or out.get("id") or "").strip()
    if tid:
        out["tool_call_id"] = tid
        out["id"] = tid
    return out


class EventType(str, Enum):
    """Event types emitted by AgentRuntime."""

    ROUND_START = "round_start"
    TOOL_CALL = "tool_call"
    TOOL_PROGRESS = "tool_progress"
    TOOL_RESULT = "tool_result"
    CONFIRM_REQUIRED = "confirm_required"
    CONFIRM_RESPONSE = "confirm_response"
    TOKEN = "token"
    FINAL = "final"
    ERROR = "error"
    SUBAGENT_STARTED = "subagent_started"
    SUBAGENT_PROGRESS = "subagent_progress"
    SUBAGENT_CHECKPOINT = "subagent_checkpoint"
    SUBAGENT_PAUSED = "subagent_paused"
    SUBAGENT_COMPLETED = "subagent_completed"
    SUBAGENT_ERROR = "subagent_error"
    COMPACTION = "compaction"


@dataclass
class RuntimeEvent:
    """One runtime event with typed name + payload."""

    type: str
    data: Dict[str, Any]
    agent_id: str = "meta"
