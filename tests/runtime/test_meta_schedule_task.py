#!/usr/bin/env python3
"""Tests for schedule_task meta tool integration.

Author: Damon Li
"""

import json
import pytest
from agenticx.runtime.task_scheduler import TaskScheduler, TaskStatus


@pytest.mark.asyncio
async def test_task_scheduler_roundtrip():
    """Full lifecycle: schedule -> list -> status check."""
    scheduler = TaskScheduler()

    async def handler(ctx):
        return f"done: {ctx.get('instruction', '')}"

    task_id = await scheduler.schedule(
        name="test_meta_task",
        handler=handler,
        context={"instruction": "check email"},
    )

    import asyncio
    await asyncio.sleep(0.3)

    tasks = scheduler.list_tasks()
    assert len(tasks) == 1
    assert tasks[0].name == "test_meta_task"
    assert tasks[0].status == TaskStatus.COMPLETED


@pytest.mark.asyncio
async def test_task_scheduler_cancel():
    """Cancel a running task."""
    import asyncio
    gate = asyncio.Event()

    async def blocked(ctx):
        await gate.wait()

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(name="blocking", handler=blocked)

    ok = scheduler.cancel_task(task_id)
    assert ok is True

    status = scheduler.get_task_status(task_id)
    assert status.status == TaskStatus.CANCELLED
    gate.set()
