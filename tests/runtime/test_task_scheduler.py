#!/usr/bin/env python3
"""Tests for TaskScheduler.

Author: Damon Li
"""

import asyncio

import pytest

from agenticx.runtime.task_scheduler import TaskScheduler, TaskStatus


@pytest.mark.asyncio
async def test_schedule_one_shot_task():
    """One-shot task should execute immediately in background."""
    results = []

    async def my_task(context):
        results.append("executed")
        return "done"

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(
        name="test_task",
        handler=my_task,
        context={"foo": "bar"},
    )
    assert task_id is not None

    await asyncio.sleep(0.2)
    status = scheduler.get_task_status(task_id)
    assert status.status == TaskStatus.COMPLETED
    assert results == ["executed"]


@pytest.mark.asyncio
async def test_schedule_task_failure_tracking():
    """Failed tasks should be tracked."""

    async def failing_task(context):
        raise ValueError("Boom")

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(name="failing", handler=failing_task)

    await asyncio.sleep(0.2)
    status = scheduler.get_task_status(task_id)
    assert status.status == TaskStatus.FAILED
    assert "Boom" in status.error


@pytest.mark.asyncio
async def test_list_tasks():
    """Should list all scheduled tasks."""
    scheduler = TaskScheduler()

    async def noop(ctx):
        return "ok"

    await scheduler.schedule(name="task_a", handler=noop)
    await scheduler.schedule(name="task_b", handler=noop)

    await asyncio.sleep(0.2)
    tasks = scheduler.list_tasks()
    assert len(tasks) == 2
    names = {t.name for t in tasks}
    assert names == {"task_a", "task_b"}


@pytest.mark.asyncio
async def test_cancel_pending_task():
    """Should be able to cancel a task that hasn't started."""
    gate = asyncio.Event()

    async def blocked_task(ctx):
        await gate.wait()

    scheduler = TaskScheduler()
    task_id = await scheduler.schedule(name="blocked", handler=blocked_task)

    cancelled = scheduler.cancel_task(task_id)
    assert cancelled is True
    gate.set()
