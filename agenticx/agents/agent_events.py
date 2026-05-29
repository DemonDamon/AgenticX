#!/usr/bin/env python3
"""Typed events for the canonical async FC ReAct agent stream.

Minimal event union (<=6 kinds) for FastAPI SSE, observability, and arun/astream
consistency. Consumed by ``react_agent_async.ReActAgent.astream``.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union

EventType = Literal[
    "token",
    "reasoning",
    "tool_call",
    "tool_result",
    "final",
    "error",
]


@dataclass
class TokenEvent:
    """A text delta from the model (optional per-turn streaming)."""

    type: Literal["token"] = "token"
    text: str = ""


@dataclass
class ReasoningEvent:
    """Marks the start of a reasoning / model-call iteration."""

    type: Literal["reasoning"] = "reasoning"
    iteration: int = 0


@dataclass
class ToolCallEvent:
    """Model requested a tool invocation."""

    type: Literal["tool_call"] = "tool_call"
    tool_call_id: str = ""
    tool_name: str = ""
    arguments: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResultEvent:
    """Result of a tool execution returned to the model."""

    type: Literal["tool_result"] = "tool_result"
    tool_call_id: str = ""
    tool_name: str = ""
    content: str = ""
    success: bool = True


@dataclass
class FinalEvent:
    """Terminal event: run completed with final output and message history."""

    type: Literal["final"] = "final"
    output: Any = None
    success: bool = True
    messages: List[Dict[str, Any]] = field(default_factory=list)
    iterations: int = 0


@dataclass
class ErrorEvent:
    """Non-fatal or terminal error surfaced on the event stream."""

    type: Literal["error"] = "error"
    message: str = ""
    recoverable: bool = False


AgentEvent = Union[
    TokenEvent,
    ReasoningEvent,
    ToolCallEvent,
    ToolResultEvent,
    FinalEvent,
    ErrorEvent,
]
