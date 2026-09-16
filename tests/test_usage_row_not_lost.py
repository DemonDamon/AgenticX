#!/usr/bin/env python3
"""Usage rows must reach the ledger even when the caller stops early.

A whole turn used to disappear from ``usage.sqlite`` because the write was
scheduled with a bare ``asyncio.create_task``: asyncio holds only a weak
reference, so the task could be collected before it ran. Losing the turn that
actually hit the prompt cache makes the Desktop popup report 0% hit rate.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.runtime.agent_runtime import (
    _USAGE_PERSIST_TASKS,
    _spawn_usage_persist_task,
)


@pytest.mark.asyncio
async def test_spawned_usage_task_is_strongly_referenced() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    done: list[str] = []

    async def _write() -> None:
        started.set()
        await release.wait()
        done.append("written")

    task = _spawn_usage_persist_task(_write())
    await started.wait()
    # While in flight the task must be held, otherwise it can be collected.
    assert task in _USAGE_PERSIST_TASKS

    release.set()
    await task
    assert done == ["written"]
    # Reference is dropped once the row landed, so the set cannot grow forever.
    await asyncio.sleep(0)
    assert task not in _USAGE_PERSIST_TASKS


@pytest.mark.asyncio
async def test_usage_task_completes_without_local_reference() -> None:
    """Simulate the runtime path: nobody awaits the write, it must still land."""
    written: list[int] = []

    async def _write() -> None:
        await asyncio.sleep(0)
        written.append(1)

    _spawn_usage_persist_task(_write())
    del _write
    # Yield control the way the turn does after scheduling the row.
    for _ in range(5):
        await asyncio.sleep(0)
    assert written == [1]
    assert not _USAGE_PERSIST_TASKS


@pytest.mark.asyncio
async def test_usage_store_record_async_writes_row(tmp_path) -> None:
    from agenticx.runtime.usage_store import UsageStore

    store = UsageStore(db_path=tmp_path / "usage.sqlite")

    async def _write() -> None:
        await store.record_async(
            session_id="s-late",
            avatar_id="",
            provider="minimax",
            model="MiniMax-M2.1",
            input_tokens=23224,
            output_tokens=205,
            cached_tokens=12987,
            reasoning_tokens=0,
            total_tokens=23429,
        )

    task = _spawn_usage_persist_task(_write())
    await task

    stats = store.cache_stats(session_id="s-late")
    assert stats["requests"] == 1
    assert stats["cached_tokens"] == 12987
    assert stats["last_input_tokens"] == 23224
