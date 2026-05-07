#!/usr/bin/env python3
"""Monotonic-clock stall detection for long-running tasks.

Author: Damon Li
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Dict


@dataclass
class StallSnapshot:
    task_id: str
    last_activity_ts: float
    elapsed_sec: float
    is_stalled: bool


@dataclass
class TaskStallDetector:
    threshold_sec: float = 300.0
    _last_activity: Dict[str, float] = field(default_factory=dict)
    _monotonic: Callable[[], float] = field(default_factory=lambda: time.monotonic)

    def touch(self, task_id: str) -> None:
        self._last_activity[str(task_id)] = float(self._monotonic())

    def forget(self, task_id: str) -> None:
        self._last_activity.pop(str(task_id), None)

    def check(self, task_id: str) -> StallSnapshot:
        tid = str(task_id)
        now = float(self._monotonic())
        last = self._last_activity.get(tid)
        if last is None:
            last = now
            self._last_activity[tid] = last
        elapsed = max(0.0, now - float(last))
        return StallSnapshot(
            task_id=tid,
            last_activity_ts=float(last),
            elapsed_sec=elapsed,
            is_stalled=elapsed > float(self.threshold_sec),
        )
