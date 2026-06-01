#!/usr/bin/env python3
"""Async ingest queue for memory graph episodes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
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
        self._seq = 0
        self._status = MemoryGraphStatusStore(self.cfg.status_path)

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
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = loop.create_task(self._run_worker(), name="memory-graph-writer")

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
        store = MemoryGraphStore.singleton()
        while True:
            job = await self._queue.get()
            try:
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
        loop.create_task(_dispatch(), name=f"memory-graph-ingest-{session_id[:8]}")
    except RuntimeError:
        logger.warning(
            "memory graph ingest skipped (no running event loop) session=%s",
            session_id,
        )
