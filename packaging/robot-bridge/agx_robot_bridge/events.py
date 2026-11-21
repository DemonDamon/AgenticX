#!/usr/bin/env python3
"""Thread-safe, bounded event log with monotonically increasing sequence numbers.

Author: Hongyi Zhao
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any


class EventLog:
    """Ring buffer of session events; evicted events never give their ``seq`` back."""

    def __init__(self, maxlen: int = 500) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._seq = 0

    def append(self, type_: str, detail: dict[str, Any] | None = None) -> int:
        with self._lock:
            self._seq += 1
            self._events.append(
                {"seq": self._seq, "ts": time.time(), "type": type_, "detail": dict(detail or {})}
            )
            return self._seq

    def since(self, seq: int) -> list[dict[str, Any]]:
        """Events with ``seq`` greater than the argument, in ascending order."""
        with self._lock:
            return [{**event, "detail": dict(event["detail"])} for event in self._events if event["seq"] > seq]

    @property
    def last_seq(self) -> int:
        with self._lock:
            return self._seq
