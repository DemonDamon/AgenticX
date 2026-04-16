#!/usr/bin/env python3
"""Session-level learning analyzer: extract signals from observations.

Analyzes tool-call observations (JSONL) from a completed session and produces
structured ``SessionSignals`` that downstream components (e.g. SessionReviewHook)
use to decide whether a skill-learning review is warranted.

Upstream reference: hermes-agent proposal v2 §4.4 — learning signal extraction.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agenticx.learning.instinct import Instinct

logger = logging.getLogger("agenticx.learning")


@dataclass
class SessionSignals:
    """Deterministic signals extracted from a session's observations."""

    tool_call_count: int = 0
    unique_tools: int = 0
    error_count: int = 0
    success_count: int = 0
    error_recovery_count: int = 0
    retry_pattern_count: int = 0
    total_elapsed_ms: int = 0

    @property
    def success_rate(self) -> float:
        total = self.success_count + self.error_count
        if total == 0:
            return 1.0
        return self.success_count / total

    @property
    def has_error_recovery(self) -> bool:
        return self.error_recovery_count > 0

    @property
    def is_complex(self) -> bool:
        return self.tool_call_count >= 5 and self.unique_tools >= 2


def load_session_observations(session_dir: Path) -> list[dict[str, Any]]:
    """Load observations from a session's ``tool_call_observations.json``."""
    obs_path = session_dir / "tool_call_observations.json"
    if not obs_path.is_file():
        return []
    try:
        data = json.loads(obs_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, ValueError, OSError):
        pass
    return []


def load_observations(jsonl_path: Path) -> list[dict[str, Any]]:
    """Load observations from a legacy JSONL file, skipping malformed lines.

    Retained for backward compatibility with existing tests.
    New code should use ``load_session_observations`` instead.
    """
    observations: list[dict[str, Any]] = []
    if not jsonl_path.is_file():
        return observations
    try:
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                observations.append(json.loads(line))
            except (json.JSONDecodeError, ValueError):
                continue
    except OSError:
        pass
    return observations


def filter_session(observations: list[dict[str, Any]], session_id: str) -> list[dict[str, Any]]:
    """Filter observations belonging to a specific session.

    Retained for backward compatibility. New code reads per-session files directly.
    """
    if not session_id:
        return observations
    return [o for o in observations if o.get("session_id") == session_id]


def extract_signals(observations: list[dict[str, Any]]) -> SessionSignals:
    """Extract deterministic learning signals from a list of observations.

    Detects:
    - error_recovery: a failed tool call followed by a successful call to
      the same tool (the agent retried and fixed it).
    - retry_pattern: consecutive calls to the same tool (regardless of success).
    """
    signals = SessionSignals()
    tools_seen: set[str] = set()
    prev_tool: str = ""
    prev_success: bool = True

    for obs in observations:
        tool = str(obs.get("tool_name", ""))
        success = bool(obs.get("success", True))
        elapsed = int(obs.get("elapsed_ms", 0))

        signals.tool_call_count += 1
        signals.total_elapsed_ms += elapsed
        tools_seen.add(tool)

        if success:
            signals.success_count += 1
            if not prev_success and tool == prev_tool:
                signals.error_recovery_count += 1
        else:
            signals.error_count += 1

        if tool == prev_tool and prev_tool:
            signals.retry_pattern_count += 1

        prev_tool = tool
        prev_success = success

    signals.unique_tools = len(tools_seen)
    return signals


class InstinctAnalyzer:
    """Analyze observations and propose instinct updates.

    Phase-1 focuses on ``extract_signals`` (deterministic, no LLM).
    Full LLM-driven instinct generation is reserved for Phase-2.
    """

    MIN_OBSERVATIONS = 3
    ANALYSIS_MODEL = "lite"

    async def analyze_session(
        self,
        observations: list[dict],
        existing_instincts: list[Instinct],
    ) -> list[Instinct]:
        """Return new or updated instincts.

        Phase-1: returns empty list. Use ``extract_signals`` for deterministic
        signal extraction; LLM-driven instinct creation is Phase-2 scope.
        """
        _ = observations, existing_instincts
        return []
