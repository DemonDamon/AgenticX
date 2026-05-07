#!/usr/bin/env python3
"""Task-level retry delays (continuation vs failure).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DelayKind = Literal["continuation", "failure"]


@dataclass(frozen=True)
class TaskRetryPolicy:
    continuation_delay_sec: float = 1.0
    failure_base_sec: float = 10.0
    failure_multiplier: float = 2.0
    max_backoff_sec: float = 300.0
    max_attempts: int = 0  # 0 = unlimited (applies to failure retries only)
    max_continuations: int = 64  # cap continuation rounds to avoid infinite loops

    def compute_delay(self, *, kind: DelayKind, attempt: int) -> float:
        if kind == "continuation" and attempt <= 1:
            return float(self.continuation_delay_sec)
        power = max(0, min(int(attempt) - 1, 10))
        raw = float(self.failure_base_sec) * (float(self.failure_multiplier) ** power)
        return min(raw, float(self.max_backoff_sec))

    def should_give_up(self, attempt: int) -> bool:
        return self.max_attempts > 0 and int(attempt) > int(self.max_attempts)

    def should_stop_continuation(self, continuation_rounds: int) -> bool:
        return self.max_continuations > 0 and int(continuation_rounds) >= int(self.max_continuations)
