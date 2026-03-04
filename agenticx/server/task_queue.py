#!/usr/bin/env python3
"""Async task queue for background agent execution.

Supports optional Redis backend for task-state persistence across restarts
and visibility across multiple server instances.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, TypeVar

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

    def to_dict(self) -> Dict[str, str]:
        """Serialize to flat string dict for Redis Hash storage."""
        return {
            "task_id": self.task_id,
            "name": self.name,
            "status": self.status.value,
            "result": json.dumps(self.result) if self.result is not None else "",
            "error": self.error or "",
            "created_at": str(self.created_at),
            "started_at": str(self.started_at) if self.started_at else "",
            "completed_at": str(self.completed_at) if self.completed_at else "",
            "progress": str(self.progress),
            "metadata": json.dumps(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AsyncTaskInfo":
        """Deserialize from Redis Hash data."""
        result_raw = data.get("result", "")
        try:
            result = json.loads(result_raw) if result_raw else None
        except (json.JSONDecodeError, TypeError):
            result = result_raw or None
        meta_raw = data.get("metadata", "{}")
        try:
            metadata = json.loads(meta_raw) if meta_raw else {}
        except (json.JSONDecodeError, TypeError):
            metadata = {}
        return cls(
            task_id=str(data.get("task_id", "")),
            name=str(data.get("name", "")),
            status=AsyncTaskStatus(data.get("status", "pending")),
            result=result,
            error=data.get("error") or None,
            created_at=float(data.get("created_at", 0)),
            started_at=float(data["started_at"]) if data.get("started_at") else None,
            completed_at=float(data["completed_at"]) if data.get("completed_at") else None,
            progress=float(data.get("progress", 0)),
            metadata=metadata,
        )


class AsyncTaskQueue:
    """Async task queue with retry support and optional Redis persistence.

    Uses BackgroundTaskPool for execution. When a Redis backend is available,
    task metadata is persisted so it survives process restarts and is visible
    across multiple server instances.
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

    def _get_backend(self):
        from agenticx.server.redis_backend import get_redis_backend
        return get_redis_backend()

    async def _persist_task(self, info: AsyncTaskInfo) -> None:
        backend = self._get_backend()
        if backend and backend.connected:
            await backend.save_task(info.task_id, info.to_dict())
            await backend.add_task_to_index(info.task_id, info.created_at)

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
        await self._persist_task(info)

        async def _run() -> None:
            async with self._semaphore:
                if task_id in self._cancel_requested:
                    info.status = AsyncTaskStatus.CANCELLED
                    await self._persist_task(info)
                    return
                info.status = AsyncTaskStatus.RUNNING
                info.started_at = time.time()
                await self._persist_task(info)
                try:
                    result = await coro_func(*args, **(kwargs or {}))
                    if task_id in self._cancel_requested:
                        info.status = AsyncTaskStatus.CANCELLED
                        await self._persist_task(info)
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
                    await self._persist_task(info)
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
        """Get task status by id. Checks local cache first, then Redis."""
        async with self._lock:
            local = self._tasks.get(task_id)
            if local:
                return local
        backend = self._get_backend()
        if backend and backend.connected:
            data = await backend.load_task(task_id)
            if data:
                return AsyncTaskInfo.from_dict(data)
        return None

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
    ) -> List[AsyncTaskInfo]:
        """List tasks, optionally filtered by status.

        Merges local in-memory tasks with Redis-persisted tasks.
        """
        async with self._lock:
            tasks = list(self._tasks.values())

        backend = self._get_backend()
        if backend and backend.connected:
            local_ids = {t.task_id for t in tasks}
            remote_ids = await backend.list_task_ids(limit=limit)
            for tid in remote_ids:
                if tid not in local_ids:
                    data = await backend.load_task(tid)
                    if data:
                        tasks.append(AsyncTaskInfo.from_dict(data))

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
