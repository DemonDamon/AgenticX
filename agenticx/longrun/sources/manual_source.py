#!/usr/bin/env python3
"""Manual enqueue source for Studio HTTP / webhook ingestion.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List


class ManualSource:
    """Simple FIFO queue filtered against completed ids."""

    def __init__(self) -> None:
        self._pending: List[Dict[str, Any]] = []
        self._done: set[str] = set()

    async def enqueue(self, payload: Dict[str, Any]) -> None:
        self._pending.append(dict(payload))

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        batch = list(self._pending)
        self._pending.clear()
        return [p for p in batch if str(p.get("id", "") or "").strip() not in self._done]

    async def mark_task_done(self, task_id: str) -> None:
        self._done.add(str(task_id).strip())
