#!/usr/bin/env python3
"""Structured safety audit event log.

Records security events from SafetyLayer pipeline stages for
observability, compliance reporting, and aggregation analysis.

Author: Damon Li
"""

import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class SafetyStage(Enum):
    TRUNCATION = "truncation"
    LEAK_DETECTION = "leak_detection"
    POLICY_CHECK = "policy_check"
    INJECTION_DEFENSE = "injection_defense"
    INPUT_VALIDATION = "input_validation"


@dataclass
class SafetyEvent:
    tool_name: str
    stage: SafetyStage
    action: str
    rule_ids: list[str]
    severity: str
    timestamp: float = field(default_factory=time.monotonic)
    details: Optional[str] = None


class SafetyAuditLog:
    """Fixed-size circular buffer of safety events with query/stats support."""

    def __init__(self, max_events: int = 1000):
        self._max = max_events
        self._events: deque[SafetyEvent] = deque(maxlen=max_events)

    def record(self, event: SafetyEvent) -> None:
        self._events.append(event)

    @property
    def events(self) -> list[SafetyEvent]:
        return list(self._events)

    def query(
        self,
        tool_name: Optional[str] = None,
        stage: Optional[SafetyStage] = None,
        severity: Optional[str] = None,
    ) -> list[SafetyEvent]:
        result = list(self._events)
        if tool_name:
            result = [e for e in result if e.tool_name == tool_name]
        if stage:
            result = [e for e in result if e.stage == stage]
        if severity:
            result = [e for e in result if e.severity == severity]
        return result

    def stats(self) -> dict:
        events = list(self._events)
        by_tool: dict[str, int] = {}
        by_stage: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        for e in events:
            by_tool[e.tool_name] = by_tool.get(e.tool_name, 0) + 1
            by_stage[e.stage.value] = by_stage.get(e.stage.value, 0) + 1
            by_severity[e.severity] = by_severity.get(e.severity, 0) + 1
        return {
            "total_events": len(events),
            "by_tool": by_tool,
            "by_stage": by_stage,
            "by_severity": by_severity,
        }
