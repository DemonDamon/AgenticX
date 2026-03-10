#!/usr/bin/env python3
"""Tool loop detection utilities for AgentRuntime."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
from typing import Any, Deque, Dict, Optional, Tuple


@dataclass
class LoopCheckResult:
    stuck: bool
    level: str
    detector: str
    message: str


class LoopDetector:
    """Detect repeating tool call patterns with warning/critical levels."""

    def __init__(
        self,
        *,
        history_size: int = 30,
        warning_threshold: int = 8,
        critical_threshold: int = 15,
    ) -> None:
        self.history_size = max(8, history_size)
        self.warning_threshold = max(3, warning_threshold)
        self.critical_threshold = max(self.warning_threshold + 1, critical_threshold)
        self._calls: Deque[Tuple[str, str]] = deque(maxlen=self.history_size)
        self._progress_marks: Deque[bool] = deque(maxlen=self.history_size)

    @staticmethod
    def args_signature(arguments: Dict[str, Any]) -> str:
        try:
            return json.dumps(arguments, ensure_ascii=False, sort_keys=True)
        except Exception:
            return str(arguments)

    def record_call(self, tool_name: str, args_signature: str, *, has_progress: bool) -> None:
        self._calls.append((tool_name, args_signature))
        self._progress_marks.append(bool(has_progress))

    def check(self) -> Optional[LoopCheckResult]:
        for detector in (self._detect_generic_repeat, self._detect_ping_pong, self._detect_no_progress):
            result = detector()
            if result is not None:
                return result
        return None

    def _classify(self, count: int) -> str:
        return "critical" if count >= self.critical_threshold else "warning"

    def _detect_generic_repeat(self) -> Optional[LoopCheckResult]:
        if len(self._calls) < self.warning_threshold:
            return None
        last = self._calls[-1]
        repeat = 1
        for idx in range(len(self._calls) - 2, -1, -1):
            if self._calls[idx] != last:
                break
            repeat += 1
        if repeat < self.warning_threshold:
            return None
        level = self._classify(repeat)
        tool_name = last[0]
        return LoopCheckResult(
            stuck=True,
            level=level,
            detector="generic_repeat",
            message=f"检测到工具 {tool_name} 连续重复调用 {repeat} 次。",
        )

    def _detect_ping_pong(self) -> Optional[LoopCheckResult]:
        if len(self._calls) < self.warning_threshold:
            return None
        # Detect A/B alternating pattern on the tail.
        tail = list(self._calls)[-self.critical_threshold :]
        if len(tail) < self.warning_threshold:
            return None
        a, b = tail[-2], tail[-1]
        if a == b:
            return None
        alt = 0
        expected = b
        for item in reversed(tail):
            if item != expected:
                break
            alt += 1
            expected = a if expected == b else b
        if alt < self.warning_threshold:
            return None
        level = self._classify(alt)
        return LoopCheckResult(
            stuck=True,
            level=level,
            detector="ping_pong",
            message=f"检测到工具调用在两个模式间来回震荡（{alt} 步）。",
        )

    def _detect_no_progress(self) -> Optional[LoopCheckResult]:
        if len(self._progress_marks) < self.warning_threshold:
            return None
        streak = 0
        for mark in reversed(self._progress_marks):
            if mark:
                break
            streak += 1
        if streak < self.warning_threshold:
            return None
        level = self._classify(streak)
        return LoopCheckResult(
            stuck=True,
            level=level,
            detector="no_progress",
            message=f"连续 {streak} 次工具调用未观察到进展（artifacts/scratchpad 未变化）。",
        )
