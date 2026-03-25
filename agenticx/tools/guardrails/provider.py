#!/usr/bin/env python3
"""Pluggable pre-tool-call authorization (DeerFlow-inspired).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class GuardrailRequest:
    """Context passed to the provider for each tool call."""

    tool_name: str
    tool_input: dict[str, Any]
    agent_id: str | None = None
    session_id: str | None = None
    timestamp: str = ""


@dataclass
class GuardrailReason:
    """Structured reason for an allow/deny decision."""

    code: str
    message: str = ""


@dataclass
class GuardrailDecision:
    """Provider verdict for a single tool call."""

    allow: bool
    reasons: list[GuardrailReason] = field(default_factory=list)
    policy_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class GuardrailProvider(Protocol):
    """Contract for pluggable tool-call authorization (structural typing)."""

    name: str

    def evaluate(self, request: GuardrailRequest) -> GuardrailDecision:
        """Evaluate whether a tool call should proceed (sync)."""
        ...

    async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision:
        """Evaluate whether a tool call should proceed (async)."""
        ...
