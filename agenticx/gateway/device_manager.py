#!/usr/bin/env python3
"""WebSocket device registry and offline message queue.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from typing import Any, Deque, Dict, Optional

from fastapi import WebSocket

from agenticx.gateway.models import GatewayMessage, GatewayReply, PendingMessage

MAX_PENDING = 100
PENDING_TTL_SECONDS = 86400


class DeviceManager:
    """Tracks online devices and pending IM messages."""

    def __init__(self) -> None:
        self._connections: Dict[str, WebSocket] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._pending: Dict[str, Deque[PendingMessage]] = {}
        self._reply_waiters: Dict[str, asyncio.Future[GatewayReply]] = {}
        self._waiter_lock = asyncio.Lock()

    def _lock_for(self, device_id: str) -> asyncio.Lock:
        if device_id not in self._locks:
            self._locks[device_id] = asyncio.Lock()
        return self._locks[device_id]

    async def register(self, device_id: str, ws: WebSocket) -> None:
        async with self._lock_for(device_id):
            old = self._connections.get(device_id)
            if old is not None:
                try:
                    await old.close(code=4000)
                except Exception:
                    pass
            self._connections[device_id] = ws

    async def unregister(self, device_id: str, ws: WebSocket) -> None:
        async with self._lock_for(device_id):
            if self._connections.get(device_id) is ws:
                del self._connections[device_id]

    def is_online(self, device_id: str) -> bool:
        return device_id in self._connections

    async def send_to_device(self, device_id: str, payload: dict[str, Any]) -> bool:
        ws = self._connections.get(device_id)
        if ws is None:
            return False
        try:
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            return False

    def enqueue_pending(self, device_id: str, message: GatewayMessage) -> None:
        q = self._pending.setdefault(device_id, deque())
        now = time.time()
        while len(q) >= MAX_PENDING:
            q.popleft()
        q.append(PendingMessage(message=message, enqueued_at=now))
        self._prune_pending(device_id, now)

    def _prune_pending(self, device_id: str, now: float) -> None:
        q = self._pending.get(device_id)
        if not q:
            return
        while q and now - q[0].enqueued_at > PENDING_TTL_SECONDS:
            q.popleft()

    def drain_pending(self, device_id: str) -> list[GatewayMessage]:
        q = self._pending.pop(device_id, None)
        if not q:
            return []
        return [p.message for p in q]

    def pending_count(self, device_id: str) -> int:
        q = self._pending.get(device_id)
        return len(q) if q else 0

    async def wait_for_reply(self, correlation_id: str, timeout: float) -> Optional[GatewayReply]:
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[GatewayReply] = loop.create_future()
        async with self._waiter_lock:
            self._reply_waiters[correlation_id] = fut
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            async with self._waiter_lock:
                self._reply_waiters.pop(correlation_id, None)

    def resolve_reply(self, correlation_id: str, reply: GatewayReply) -> bool:
        fut = self._reply_waiters.get(correlation_id)
        if fut is None or fut.done():
            return False
        fut.set_result(reply)
        return True
