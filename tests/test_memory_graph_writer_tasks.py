#!/usr/bin/env python3
"""Regression tests for orphaned asyncio work in the memory-graph writer.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import gc
import sys
from unittest.mock import patch

from agenticx.memory.graph import writer as W
from agenticx.memory.graph.writer import MemoryGraphWriter


def _make_writer() -> MemoryGraphWriter:
    """A writer without the config / status-file side effects of __init__."""
    obj = MemoryGraphWriter.__new__(MemoryGraphWriter)
    obj.cfg = W.load_memory_graph_config()
    obj._queue = asyncio.PriorityQueue(maxsize=8)
    obj._worker_task = None
    obj._worker_loop = None
    obj._seq = 0
    obj._status = None
    return obj


async def _idle_worker(writer: MemoryGraphWriter) -> None:
    """Suspends inside ``queue.get()`` exactly like the real worker does."""
    while True:
        await writer._queue.get()
        writer._queue.task_done()


def test_dispatch_task_is_kept_alive_until_it_finishes() -> None:
    """asyncio 只对运行中的 task 持弱引用。

    ``schedule_turn_ingest_from_session`` 丢掉 create_task 的返回值时，这一轮 ingest
    可能跑到一半被 GC 掉 —— 记忆图谱静悄悄少一轮，没有任何报错。
    """
    asyncio.run(_exercise_dispatch_task_lifetime())


async def _exercise_dispatch_task_lifetime() -> None:
    started = asyncio.Event()
    finished = asyncio.Event()

    class _SlowWriter:
        async def enqueue_turn(self, **_kwargs) -> bool:
            started.set()
            await asyncio.sleep(0.05)
            finished.set()
            return True

    class _Cfg:
        enabled = True
        ingest = type("I", (), {"auto": True, "max_queue": 8})()

    with (
        patch.object(W.MemoryGraphWriter, "singleton", classmethod(lambda cls: _SlowWriter())),
        patch.object(W, "load_memory_graph_config", lambda: _Cfg()),
        patch.object(W, "graphiti_available", lambda: True),
        patch.object(W, "extract_last_turn_messages", lambda _h: [{"role": "user", "content": "x"}]),
    ):
        W._pending_dispatches.clear()
        W.schedule_turn_ingest_from_session("sess-graph", avatar_id=None, chat_history=[{}])
        await asyncio.wait_for(started.wait(), timeout=2)

        # 在飞的时候必须被强引用着，GC 一轮也不能把它带走。
        assert len(W._pending_dispatches) == 1
        gc.collect()
        assert len(W._pending_dispatches) == 1

        await asyncio.wait_for(finished.wait(), timeout=2)
        await asyncio.sleep(0)
        # 跑完之后要自己摘掉，不能攒成内存泄漏。
        assert W._pending_dispatches == set()

class _NoopStatus:
    def mark_job_started(self): ...
    def record_success(self, **_kw): ...
    def record_failure(self, _msg): ...
    def increment_pending(self, _n): ...


class _FakeStore:
    @classmethod
    def singleton(cls):
        return cls()

    async def ingest_turn(self, **_kwargs) -> None:
        await asyncio.sleep(0)

    async def get_overview(self, *_a, **_kw):
        return {"meta": {"nodeCount": 1, "edgeCount": 0}}


def _job(seq: int = 1) -> W._IngestJob:
    return W._IngestJob(
        priority=1, seq=seq, group_id="g", session_id="s", messages=[{"role": "user", "content": "x"}]
    )


def test_worker_exits_when_the_queue_drains() -> None:
    """worker 不能永远挂在 queue.get() 里等下一个 job。

    挂着的协程会在队列内部留一个绑定当前循环的 future；循环关掉后这个协程被 GC 时
    就会炸出无法捕获的 "Event loop is closed"。排空即退出，下次入队再拉起。
    """
    writer = _make_writer()
    writer._status = _NoopStatus()

    async def _run() -> None:
        with patch.object(W, "MemoryGraphStore", _FakeStore):
            writer._queue.put_nowait(_job())
            writer._ensure_worker()
            await asyncio.wait_for(writer._queue.join(), timeout=2)
            await asyncio.sleep(0)
            assert writer._worker_task is not None
            assert writer._worker_task.done(), "队列排空后 worker 必须自己结束"

    asyncio.run(_run())


def test_a_closed_loop_leaves_no_unraisable_behind() -> None:
    """本文件的核心回归：跑完一轮、关掉循环、换新循环、再 GC —— 不能冒出任何 unraisable。

    真实顺序就是这样：``loop.close()`` 不取消 pending task，worker 还挂在旧队列的
    ``get()`` 里；等下一个循环把队列换掉、旧 getter 失去引用，GC 收走那个协程时，
    ``Queue.get`` 的收尾会对属于死循环的 future 调 ``cancel()``，抛出无法捕获的
    "Event loop is closed" —— 并被算在当时碰巧在跑的那个用例头上。
    """
    writer = _make_writer()
    writer._status = _NoopStatus()

    async def _run() -> None:
        writer._queue.put_nowait(_job())
        writer._ensure_worker()
        await asyncio.wait_for(writer._queue.join(), timeout=2)

    loop = asyncio.new_event_loop()
    try:
        with patch.object(W, "MemoryGraphStore", _FakeStore):
            loop.run_until_complete(_run())
    finally:
        loop.close()

    caught: list = []
    previous_hook = sys.unraisablehook
    sys.unraisablehook = caught.append
    try:
        # 换到新循环：这一步会丢掉旧队列，旧 worker 协程随之失去最后的引用。
        with patch.object(W, "MemoryGraphStore", _FakeStore):
            asyncio.run(_run())
        gc.collect()
        gc.collect()
    finally:
        sys.unraisablehook = previous_hook

    offenders = [c for c in caught if "Event loop is closed" in str(getattr(c, "exc_value", ""))]
    assert not offenders, f"关掉的循环留下了 unraisable：{offenders}"


def test_stale_worker_is_dropped_when_the_loop_changes() -> None:
    writer = _make_writer()
    writer._status = _NoopStatus()

    async def _run() -> None:
        with patch.object(W, "MemoryGraphStore", _FakeStore):
            writer._queue.put_nowait(_job())
            writer._ensure_worker()
            await asyncio.wait_for(writer._queue.join(), timeout=2)

    asyncio.run(_run())
    first_loop = writer._worker_loop
    asyncio.run(_run())
    assert writer._worker_loop is not first_loop


def test_aclose_cancels_and_awaits_the_worker() -> None:
    writer = _make_writer()
    writer._status = _NoopStatus()

    async def _run() -> None:
        async def _hang() -> None:
            await asyncio.Event().wait()

        writer._run_worker = _hang  # type: ignore[assignment]
        writer._ensure_worker()
        await asyncio.sleep(0)
        task = writer._worker_task
        assert task is not None and not task.done()
        await writer.aclose()
        assert task.done()
        assert writer._worker_task is None

    asyncio.run(_run())
