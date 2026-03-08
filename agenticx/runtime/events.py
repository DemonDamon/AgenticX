#!/usr/bin/env python3
"""Runtime event protocol for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict


class EventType(str, Enum):
    """Event types emitted by AgentRuntime."""

    ROUND_START = "round_start"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    CONFIRM_REQUIRED = "confirm_required"
    CONFIRM_RESPONSE = "confirm_response"
    TOKEN = "token"
    FINAL = "final"
    ERROR = "error"


@dataclass
class RuntimeEvent:
    """One runtime event with typed name + payload."""

    type: str
    data: Dict[str, Any]
