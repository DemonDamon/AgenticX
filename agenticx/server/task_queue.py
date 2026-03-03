#!/usr/bin/env python3
"""Async task queue for background agent execution.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional, TypeVar

from agenticx.core.background import BackgroundTaskPool, TaskStatus as BgTaskStatus
from agenticx.core.background import TaskPriority

logger = logging.getLogger(__name__)

T = TypeVar("T")


class AsyncTaskStatus(str, Enum):
    """Status of an async task in the queue."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class AsyncTaskInfo:
    """Metadata for an async task."""

    task_id: str
    name: str
    status: AsyncTaskStatus = AsyncTaskStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    progress: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def execution_time_ms(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at) * 1000
        return None


class AsyncTaskQueue:
    """Async task queue with retry support.

    Uses BackgroundTaskPool for execution. Supports submit, status, cancel.
    """

    def __init__(
        self,
        pool: Optional[BackgroundTaskPool] = None,
        max_concurrent: int = 10,
    ) -> None:
        self._pool = pool or BackgroundTaskPool.get_default()
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._tasks: Dict[str, AsyncTaskInfo] = {}
        self._bg_task_ids: Dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._cancel_requested: set = set()

    def _generate_task_id(self) -> str:
        return f"task-{uuid.uuid4().hex[:12]}"

    async def submit(
        self,
        coro_func: Callable[..., Any],
        args: tuple = (),
        kwargs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
    ) -> str:
        """Submit an async task. Returns task_id."""
        task_id = self._generate_task_id()
        task_name = name or getattr(coro_func, "__name__", "unknown")

        info = AsyncTaskInfo(task_id=task_id, name=task_name)
        async with self._lock:
            self._tasks[task_id] = info

        async def _run() -> None:
            async with self._semaphore:
                if task_id in self._cancel_requested:
                    info.status = AsyncTaskStatus.CANCELLED
                    return
                info.status = AsyncTaskStatus.RUNNING
                info.started_at = time.time()
                try:
                    result = await coro_func(*args, **(kwargs or {}))
                    if task_id in self._cancel_requested:
                        info.status = AsyncTaskStatus.CANCELLED
                        return
                    info.result = result
                    info.status = AsyncTaskStatus.COMPLETED
                    info.progress = 1.0
                except asyncio.CancelledError:
                    info.status = AsyncTaskStatus.CANCELLED
                except Exception as e:
                    info.status = AsyncTaskStatus.FAILED
                    info.error = f"{type(e).__name__}: {str(e)}"
                    logger.warning("AsyncTaskQueue task %s failed: %s", task_id, e)
                finally:
                    info.completed_at = time.time()
                    async with self._lock:
                        if task_id in self._bg_task_ids:
                            del self._bg_task_ids[task_id]
                        self._cancel_requested.discard(task_id)

        bg_id = await self._pool.submit_async(
            _run,
            args=(),
            kwargs={},
            name=task_name,
            priority=TaskPriority.NORMAL,
        )
        async with self._lock:
            self._bg_task_ids[task_id] = bg_id

        return task_id

    async def get_status(self, task_id: str) -> Optional[AsyncTaskInfo]:
        """Get task status by id."""
        async with self._lock:
            return self._tasks.get(task_id)

    async def cancel(self, task_id: str) -> bool:
        """Request cancellation. Returns True if request was registered."""
        async with self._lock:
            if task_id not in self._tasks:
                return False
            info = self._tasks[task_id]
            if info.status in (AsyncTaskStatus.COMPLETED, AsyncTaskStatus.FAILED, AsyncTaskStatus.CANCELLED):
                return False
            self._cancel_requested.add(task_id)
            return True

    async def list_tasks(
        self,
        status: Optional[AsyncTaskStatus] = None,
        limit: int = 100,
    ) -> list[AsyncTaskInfo]:
        """List tasks, optionally filtered by status."""
        async with self._lock:
            tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]


class BackgroundAgentRunner:
    """Submit long-running agent tasks to AsyncTaskQueue with progress tracking."""

    def __init__(self, queue: Optional[AsyncTaskQueue] = None) -> None:
        self._queue = queue or AsyncTaskQueue()

    async def submit_agent_task(
        self,
        agent_run_func: Callable[..., Any],
        args: tuple = (),
        kwargs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
    ) -> str:
        """Submit agent run to background. Returns task_id for status/cancel."""
        return await self._queue.submit(
            agent_run_func,
            args=args,
            kwargs=kwargs,
            name=name or "agent_run",
        )

    async def get_task_status(self, task_id: str) -> Optional[AsyncTaskInfo]:
        """Get task status."""
        return await self._queue.get_status(task_id)

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task."""
        return await self._queue.cancel(task_id)


_default_queue: Optional[AsyncTaskQueue] = None


def get_task_queue() -> AsyncTaskQueue:
    """Get default task queue singleton."""
    global _default_queue
    if _default_queue is None:
        _default_queue = AsyncTaskQueue()
    return _default_queue
