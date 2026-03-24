#!/usr/bin/env python3
"""Background task scheduler for AgenticX runtime.

Provides one-shot and (future) cron-based task scheduling.
Inspired by Claude Dispatch's background task execution model.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ScheduledTask:
    task_id: str
    name: str
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    _async_task: Optional[asyncio.Task] = field(default=None, repr=False)


class TaskScheduler:
    """Simple background task scheduler.

    Manages one-shot async tasks with status tracking, cancellation,
    and result retrieval.
    """

    def __init__(self) -> None:
        self._tasks: Dict[str, ScheduledTask] = {}

    async def schedule(
        self,
        name: str,
        handler: Callable[[Any], Coroutine],
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Schedule a one-shot background task.

        Args:
            name: Human-readable task name.
            handler: Async callable to execute.
            context: Optional context dict passed to handler.

        Returns:
            task_id for status queries.
        """
        task_id = str(uuid.uuid4())
        scheduled = ScheduledTask(task_id=task_id, name=name)
        self._tasks[task_id] = scheduled

        async def _run():
            scheduled.status = TaskStatus.RUNNING
            try:
                result = await handler(context or {})
                scheduled.status = TaskStatus.COMPLETED
                scheduled.result = result
            except asyncio.CancelledError:
                scheduled.status = TaskStatus.CANCELLED
            except Exception as exc:
                scheduled.status = TaskStatus.FAILED
                scheduled.error = str(exc)
                logger.error("Task %s (%s) failed: %s", name, task_id, exc)
            finally:
                scheduled.completed_at = datetime.now()

        scheduled._async_task = asyncio.create_task(_run())
        return task_id

    def get_task_status(self, task_id: str) -> ScheduledTask:
        """Get status of a scheduled task."""
        task = self._tasks.get(task_id)
        if task is None:
            raise KeyError(f"Unknown task: {task_id}")
        return task

    def list_tasks(self) -> List[ScheduledTask]:
        """List all scheduled tasks."""
        return list(self._tasks.values())

    def cancel_task(self, task_id: str) -> bool:
        """Cancel a task if possible."""
        task = self._tasks.get(task_id)
        if task is None:
            return False
        if task._async_task and not task._async_task.done():
            task._async_task.cancel()
            task.status = TaskStatus.CANCELLED
            return True
        return False
