#!/usr/bin/env python3
"""Async ingest queue for memory graph episodes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from agenticx.memory.graph.config import load_memory_graph_config
from agenticx.memory.graph.group_id import derive_group_id_from_avatar_id
from agenticx.memory.graph.status import MemoryGraphStatusStore
from agenticx.memory.graph.store import (
    MemoryGraphStore,
    extract_last_turn_messages,
    graphiti_available,
    load_session_messages,
)

logger = logging.getLogger(__name__)


@dataclass(order=True)
class _IngestJob:
    priority: int
    seq: int
    group_id: str = field(compare=False)
    session_id: str = field(compare=False)
    messages: List[Dict[str, Any]] = field(compare=False)
    source_description: str = field(compare=False, default="near-chat-turn")


class MemoryGraphWriter:
    """Background worker for Graphiti ingest."""

    def __init__(self) -> None:
        self.cfg = load_memory_graph_config()
        self._queue: asyncio.PriorityQueue[_IngestJob] = asyncio.PriorityQueue(
            maxsize=self.cfg.ingest.max_queue
        )
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._worker_loop: Optional[asyncio.AbstractEventLoop] = None
        self._seq = 0
        self._status = MemoryGraphStatusStore(self.cfg.status_path)
        self._status.reconcile_after_restart(queue_size=0)

    @classmethod
    def singleton(cls) -> "MemoryGraphWriter":
        global _writer_singleton
        if _writer_singleton is None:
            _writer_singleton = cls()
        return _writer_singleton

    def _ensure_worker(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._worker_loop is not None and self._worker_loop is not loop:
            self._drop_stale_worker(loop)
        if self._worker_task is None or self._worker_task.done():
            self._worker_loop = loop
            self._worker_task = loop.create_task(self._run_worker(), name="memory-graph-writer")

    def _drop_stale_worker(self, loop: asyncio.AbstractEventLoop) -> None:
        """单例被另一个事件循环复用时，换掉绑在旧循环上的 worker 和队列。

        队列必须一起换：``asyncio.Queue`` 内部的 ``_finished`` 是一个 ``asyncio.Event``，
        一旦有人 await 过 ``join()`` 就会**绑定**到那个循环，之后在新循环上再用就直接抛
        「bound to a different event loop」。job 本身是纯数据，搬过去即可。
        """
        old_task = self._worker_task
        old_loop = self._worker_loop
        self._worker_task = None
        self._worker_loop = loop

        pending: List[_IngestJob] = []
        while True:
            try:
                pending.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        self._queue = asyncio.PriorityQueue(maxsize=self.cfg.ingest.max_queue)
        for job in pending:
            try:
                self._queue.put_nowait(job)
            except asyncio.QueueFull:
                logger.warning("memory graph queue full while rebinding; dropping job")
                break

        if old_task is None or old_task.done():
            return
        if old_loop is not None and not old_loop.is_closed():
            # 旧循环还活着，让它自己把 worker 收掉。
            old_loop.call_soon_threadsafe(old_task.cancel)
        else:
            logger.debug("memory graph worker dropped with its closed loop")

    async def aclose(self) -> None:
        """Cancel the worker and await it. Call on shutdown so it never outlives its loop."""
        task = self._worker_task
        self._worker_task = None
        self._worker_loop = None
        if task is None or task.done():
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def enqueue_turn(
        self,
        *,
        group_id: str,
        session_id: str,
        messages: List[Dict[str, Any]],
        priority: int = 10,
        source_description: str = "near-chat-turn",
    ) -> bool:
        cfg = load_memory_graph_config()
        if not cfg.enabled or not cfg.ingest.auto:
            return False
        if not graphiti_available():
            return False
        if not messages:
            return False
        self._seq += 1
        job = _IngestJob(
            priority=priority,
            seq=self._seq,
            group_id=group_id,
            session_id=session_id,
            messages=messages,
            source_description=source_description,
        )
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull:
            logger.warning("memory graph ingest queue full; dropping job for %s", session_id)
            return False
        self._status.increment_pending(1)
        self._ensure_worker()
        return True

    async def _run_worker(self) -> None:
        """Drain the queue, then exit. Never suspend inside ``queue.get()``.

        用 ``get_nowait()`` 而不是 ``await get()`` 是这里的关键。挂在 ``Queue.get()`` 里的
        协程会在队列内部留下一个**绑定当前循环**的 future；一旦这个循环在 worker 还挂着的
        时候被关掉（``loop.close()`` 不取消 pending task），之后某次 GC 关闭该协程时，
        ``Queue.get`` 的收尾会对那个属于死循环的 future 调 ``cancel()``，抛出无法捕获的
        ``RuntimeError: Event loop is closed`` —— 而且会被算在当时碰巧在跑的那段代码头上。

        队列空了就结束，下一次 ``enqueue_turn`` 会重新拉起。``put_nowait`` 和
        ``_ensure_worker`` 之间没有 await，所以不存在「刚好在退出瞬间入队」的竞态。
        """
        store = MemoryGraphStore.singleton()
        while True:
            try:
                job = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                self._status.mark_job_started()
                await store.ingest_turn(
                    group_id=job.group_id,
                    session_id=job.session_id,
                    messages=job.messages,
                    reference_time=datetime.now(timezone.utc),
                    source_description=job.source_description,
                )
                overview = await store.get_overview(job.group_id, limit_nodes=200, limit_edges=400)
                meta = overview.get("meta") or {}
                self._status.record_success(
                    node_count=int(meta.get("nodeCount") or 0),
                    edge_count=int(meta.get("edgeCount") or 0),
                )
                cfg = load_memory_graph_config()
                if cfg.retention.enabled and cfg.retention.on_ingest:
                    try:
                        await store.prune_episodes(
                            job.group_id,
                            max_episodes=cfg.retention.max_episodes,
                            max_age_days=cfg.retention.max_age_days,
                            dry_run=False,
                        )
                    except Exception as exc:
                        logger.warning(
                            "memory graph retention failed for %s: %s",
                            job.group_id,
                            exc,
                        )
            except Exception as exc:
                logger.warning("memory graph ingest failed: %s", exc, exc_info=True)
                self._status.record_failure(str(exc))
            finally:
                self._queue.task_done()

    async def enqueue_favorite(
        self,
        *,
        session_id: str,
        avatar_id: Optional[str],
        content: str,
        role: str,
    ) -> bool:
        group_id = derive_group_id_from_avatar_id(avatar_id, session_id=session_id)
        messages = [{"role": role, "content": content}]
        return await self.enqueue_turn(
            group_id=group_id,
            session_id=session_id,
            messages=messages,
            priority=0,
            source_description="near-favorite",
        )


_writer_singleton: Optional[MemoryGraphWriter] = None

#: 在飞的 fire-and-forget ingest task；只为持一个强引用，跑完自己摘掉。
_pending_dispatches: set[asyncio.Task[None]] = set()


def schedule_turn_ingest_from_session(
    session_id: str,
    *,
    avatar_id: Optional[str],
    chat_history: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Fire-and-forget ingest after chat turn (called from sync server code)."""
    cfg = load_memory_graph_config()
    if not cfg.enabled or not cfg.ingest.auto or not graphiti_available():
        return
    history = chat_history if chat_history is not None else load_session_messages(session_id)
    messages = extract_last_turn_messages(history)
    if not messages:
        return
    # 按会话天然归属路由：群聊→group:<gid>，分身→avatar:<aid>，Meta→meta:default
    group_id = derive_group_id_from_avatar_id(avatar_id, session_id=session_id)

    async def _dispatch() -> None:
        writer = MemoryGraphWriter.singleton()
        await writer.enqueue_turn(
            group_id=group_id,
            session_id=session_id,
            messages=messages,
            priority=10,
        )

    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_dispatch(), name=f"memory-graph-ingest-{session_id[:8]}")
        # asyncio 只对运行中的 task 持弱引用。不留住返回值，这一轮 ingest 就可能在跑到
        # 一半时被 GC 掉 —— 记忆图谱静悄悄少一轮，谁也不会收到报错。
        _pending_dispatches.add(task)
        task.add_done_callback(_pending_dispatches.discard)
    except RuntimeError:
        logger.warning(
            "memory graph ingest skipped (no running event loop) session=%s",
            session_id,
        )
