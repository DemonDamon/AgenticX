#!/usr/bin/env python3
"""TaskSource multiplexer.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Protocol, Sequence

from agenticx.longrun.sources.cron_source import CronSource
from agenticx.longrun.sources.linear_source import LinearTaskSource
from agenticx.longrun.sources.manual_source import ManualSource


class TaskSource(Protocol):
    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]: ...

    async def mark_task_done(self, task_id: str) -> None: ...


class ComboTaskSource:
    """Merge manual queue then cron rows."""

    def __init__(self, manual: ManualSource, cron: CronSource) -> None:
        self.manual = manual
        self.cron = cron

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        merged = list(await self.manual.fetch_pending_tasks())
        merged.extend(await self.cron.fetch_pending_tasks())
        return merged

    async def mark_task_done(self, task_id: str) -> None:
        await self.manual.mark_task_done(task_id)
        await self.cron.mark_task_done(task_id)


def merge_sources(*sources: TaskSource) -> Sequence[TaskSource]:
    return sources


__all__ = [
    "ComboTaskSource",
    "CronSource",
    "LinearTaskSource",
    "ManualSource",
    "TaskSource",
    "merge_sources",
]
