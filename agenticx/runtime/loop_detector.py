#!/usr/bin/env python3
"""Tool loop detection utilities for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
import re
from typing import Any, Deque, Dict, List, Optional, Tuple


@dataclass
class LoopCheckResult:
    stuck: bool
    level: str
    detector: str
    message: str
    nudge: Optional[str] = None


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
        self._last_success_fingerprint: Dict[str, str] = {}

    @staticmethod
    def args_signature(arguments: Dict[str, Any]) -> str:
        try:
            return json.dumps(arguments, ensure_ascii=False, sort_keys=True)
        except Exception:
            return str(arguments)

    @staticmethod
    def fingerprint_from_result(result: str) -> str:
        """Short ASCII-ish token fingerprint from a tool result body (paths/URLs)."""
        if not result or not isinstance(result, str):
            return ""
        found: List[str] = []
        blob = result[:6000]
        for m in re.finditer(r"(https?://[^\s<]+|/[\w./+\-]{3,})", blob):
            tok = m.group(0).rstrip(").,;'\"]")
            if tok and tok not in found:
                found.append(tok[:120])
            if len(found) >= 4:
                break
        joined = "; ".join(found)
        return joined[:256]

    def record_call(
        self,
        tool_name: str,
        args_signature: str,
        *,
        has_progress: bool,
        result_fingerprint: Optional[str] = None,
    ) -> None:
        self._calls.append((tool_name, args_signature))
        self._progress_marks.append(bool(has_progress))
        if result_fingerprint:
            snap = result_fingerprint[:256]
            if snap:
                self._last_success_fingerprint[tool_name] = snap

    def _nudge_for_tool(self, tool_name: str) -> Optional[str]:
        fp = self._last_success_fingerprint.get(tool_name)
        if not fp:
            return None
        text = (
            f"同名工具「{tool_name}」最近一次成功产出含：{fp}。"
            "若当前为重试怪圈，请先复用上一步结果而非忽略。"
        )
        return text[:200]

    def _with_nudge(self, tool_name: str, result: LoopCheckResult) -> LoopCheckResult:
        nudge = self._nudge_for_tool(tool_name)
        if not nudge:
            return result
        return LoopCheckResult(
            stuck=result.stuck,
            level=result.level,
            detector=result.detector,
            message=result.message,
            nudge=nudge,
        )

    def check(self) -> Optional[LoopCheckResult]:
        for detector in (
            self._detect_generic_repeat,
            self._detect_ping_pong,
            self._detect_no_progress,
            self._detect_tool_saturation,
        ):
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
        return self._with_nudge(
            tool_name,
            LoopCheckResult(
                stuck=True,
                level=level,
                detector="generic_repeat",
                message=f"检测到工具 {tool_name} 连续重复调用 {repeat} 次。",
            ),
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
        tool_name = tail[-1][0]
        return self._with_nudge(
            tool_name,
            LoopCheckResult(
                stuck=True,
                level=level,
                detector="ping_pong",
                message=f"检测到工具调用在两个模式间来回震荡（{alt} 步）。",
            ),
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
        tool_name = self._calls[-1][0]
        return self._with_nudge(
            tool_name,
            LoopCheckResult(
                stuck=True,
                level=level,
                detector="no_progress",
                message=f"连续 {streak} 次工具调用未观察到进展（artifacts/scratchpad 未变化）。",
            ),
        )

    def _detect_tool_saturation(self) -> Optional[LoopCheckResult]:
        """Detect one tool dominating recent calls with little recorded progress."""
        if len(self._calls) < self.warning_threshold:
            return None
        tail = list(self._calls)[-self.critical_threshold :]
        progress_tail = list(self._progress_marks)[-self.critical_threshold :]
        if len(tail) != len(progress_tail):
            return None
        tool_counts: Dict[str, int] = {}
        for name, _ in tail:
            tool_counts[name] = tool_counts.get(name, 0) + 1
        for tool_name, count in tool_counts.items():
            if count < self.warning_threshold:
                continue
            tool_indices = [i for i, (n, _) in enumerate(tail) if n == tool_name]
            no_progress_count = sum(
                1 for i in tool_indices if i < len(progress_tail) and not progress_tail[i]
            )
            if no_progress_count >= self.warning_threshold:
                level = self._classify(no_progress_count)
                return self._with_nudge(
                    tool_name,
                    LoopCheckResult(
                        stuck=True,
                        level=level,
                        detector="tool_saturation",
                        message=(
                            f"工具 {tool_name} 在近期窗口内调用 {count} 次，其中 {no_progress_count} 次未观察到有效进展。"
                        ),
                    ),
                )
        return None
