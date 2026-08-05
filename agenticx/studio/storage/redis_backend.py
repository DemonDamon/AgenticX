#!/usr/bin/env python3
"""Redis-backed session storage for multi-replica (HA) deployments.

Key layout (the shared ``RedisBackend`` prepends its ``agenticx:`` prefix):

- ``sess:{sid}:messages`` / ``sess:{sid}:agent_messages`` /
  ``sess:{sid}:tail`` / ``sess:{sid}:agent_state`` — JSON strings via ``SET``
- ``automation:tasks`` — automation task list JSON
- ``mcp:state`` — MCP last-connected/quarantine state JSON

All Redis I/O runs on a dedicated event loop in a daemon thread owned by
this instance, because ``redis.asyncio`` clients are loop-affine while this
backend must serve both async callers (the protocol) and legacy sync callers
(via ``run_sync``). Async protocol methods bridge onto that loop with
``run_coroutine_threadsafe`` + ``asyncio.wrap_future``.

Connection management reuses ``agenticx.server.redis_backend.RedisBackend``
(connection pool, ``AGENTICX_REDIS_URL``/``REDIS_URL`` env fallback, graceful
degradation): when Redis is unavailable, loads return empty values and saves
log warnings instead of raising.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any

from agenticx.server.redis_backend import RedisBackend as SharedRedisBackend
from agenticx.studio.storage.local_file import _parse_messages_payload

logger = logging.getLogger(__name__)

_AGENT_MESSAGES_TAIL = 40
_MAX_PAYLOAD_WARN_BYTES = 8 * 1024 * 1024
_CONNECT_RETRY_INTERVAL_SEC = 10.0
_SYNC_CALL_TIMEOUT_SEC = 10.0


class RedisSessionStorage:
    """``SessionStorageBackend`` implementation backed by Redis."""

    def __init__(
        self,
        *,
        redis_backend: SharedRedisBackend | None = None,
        url: str | None = None,
    ) -> None:
        self._rb = redis_backend or SharedRedisBackend(url=url)
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._loop.run_forever,
            name="agx-storage-redis",
            daemon=True,
        )
        self._thread.start()
        self._connect_lock = threading.Lock()
        self._last_connect_attempt = 0.0

    # ── Loop bridge ──

    def run_sync(self, coro: Any, timeout: float = _SYNC_CALL_TIMEOUT_SEC) -> Any:
        """Run a coroutine on the backend loop and block until done."""
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout)

    async def _bridge(self, coro: Any) -> Any:
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return await asyncio.wrap_future(future)

    def close(self) -> None:
        """Shut down the backend loop thread (tests / factory reset)."""
        try:
            if self._rb.connected:
                disconnect = asyncio.run_coroutine_threadsafe(
                    self._rb.close(), self._loop
                )
                disconnect.result(timeout=5.0)
        except Exception:
            logger.debug("redis storage close failed", exc_info=True)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5.0)

    def _connect_throttled(self) -> bool:
        """Return True when a connect attempt should be made now."""
        if self._rb.connected:
            return False
        now = time.monotonic()
        with self._connect_lock:
            if self._rb.connected:
                return False
            if (now - self._last_connect_attempt) < _CONNECT_RETRY_INTERVAL_SEC:
                return False
            self._last_connect_attempt = now
            return True

    def _ensure_connected(self) -> None:
        """Connect from a foreign thread (sync callers)."""
        if not self._connect_throttled():
            return
        try:
            attempt = asyncio.run_coroutine_threadsafe(
                self._rb.connect(), self._loop
            )
            attempt.result(timeout=8.0)
        except Exception:
            logger.warning("redis storage connect attempt failed", exc_info=True)

    async def _ensure_connected_async(self) -> None:
        """Connect from the backend loop thread.

        Impl coroutines execute on ``self._loop``; they must await the
        connect directly. Scheduling it back onto the same loop and blocking
        on the future would deadlock the loop until the timeout.
        """
        if not self._connect_throttled():
            return
        try:
            await asyncio.wait_for(self._rb.connect(), timeout=8.0)
        except Exception:
            logger.warning("redis storage connect attempt failed", exc_info=True)

    # ── Key helpers ──

    @staticmethod
    def _session_key(session_id: str, kind: str) -> str:
        return f"sess:{session_id}:{kind}"

    # ── JSON primitives (run on the backend loop) ──

    async def _save_json(self, key: str, obj: Any) -> None:
        await self._ensure_connected_async()
        payload = json.dumps(obj, ensure_ascii=False)
        if len(payload.encode("utf-8")) > _MAX_PAYLOAD_WARN_BYTES:
            logger.warning(
                "redis storage payload exceeds 8MB key=%s size=%d",
                key,
                len(payload),
            )
        ok = await self._rb.set(key, payload)
        if not ok:
            logger.warning("redis storage save degraded (unavailable) key=%s", key)

    async def _load_json(self, key: str, empty: Any) -> Any:
        await self._ensure_connected_async()
        raw = await self._rb.get(key)
        if raw is None:
            return empty
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            logger.warning("redis storage corrupt JSON key=%s (ignored)", key)
            return empty

    # ── Protocol implementations (async, bridged) ──

    async def load_messages(self, session_id: str) -> list[dict]:
        return await self._bridge(self._load_messages_impl(session_id))

    async def save_messages(self, session_id: str, messages: list[dict]) -> None:
        await self._bridge(self._save_messages_impl(session_id, messages))

    async def load_agent_messages(self, session_id: str) -> list[dict]:
        return await self._bridge(self._load_agent_messages_impl(session_id))

    async def save_agent_messages(self, session_id: str, messages: list[dict]) -> None:
        await self._bridge(self._save_agent_messages_impl(session_id, messages))

    async def load_messages_tail(self, session_id: str) -> dict | None:
        return await self._bridge(self._load_messages_tail_impl(session_id))

    async def save_messages_tail(self, session_id: str, tail: dict) -> None:
        await self._bridge(self._save_messages_tail_impl(session_id, tail))

    async def load_agent_state(self, session_id: str) -> dict | None:
        return await self._bridge(self._load_agent_state_impl(session_id))

    async def save_agent_state(self, session_id: str, state: dict) -> None:
        await self._bridge(self._save_agent_state_impl(session_id, state))

    async def delete_session(self, session_id: str) -> None:
        await self._bridge(self._delete_session_impl(session_id))

    async def load_automation_tasks(self) -> list[dict]:
        return await self._bridge(self._load_automation_tasks_impl())

    async def save_automation_tasks(self, tasks: list[dict]) -> None:
        await self._bridge(self._save_automation_tasks_impl(tasks))

    async def load_mcp_state(self) -> dict:
        return await self._bridge(self._load_mcp_state_impl())

    async def save_mcp_state(self, state: dict) -> None:
        await self._bridge(self._save_mcp_state_impl(state))

    async def ping(self) -> bool:
        return await self._bridge(self._ping_impl())

    # ── Impl coroutines (executed on the backend loop) ──

    async def _load_messages_impl(self, session_id: str) -> list[dict]:
        data = await self._load_json(self._session_key(session_id, "messages"), None)
        return _parse_messages_payload(data)

    async def _save_messages_impl(self, session_id: str, messages: list[dict]) -> None:
        await self._save_json(self._session_key(session_id, "messages"), messages)

    async def _load_agent_messages_impl(self, session_id: str) -> list[dict]:
        data = await self._load_json(self._session_key(session_id, "agent_messages"), [])
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    async def _save_agent_messages_impl(self, session_id: str, messages: list[dict]) -> None:
        await self._save_json(
            self._session_key(session_id, "agent_messages"),
            messages[-_AGENT_MESSAGES_TAIL:],
        )

    async def _load_messages_tail_impl(self, session_id: str) -> dict | None:
        data = await self._load_json(self._session_key(session_id, "tail"), None)
        return data if isinstance(data, dict) else None

    async def _save_messages_tail_impl(self, session_id: str, tail: dict) -> None:
        await self._save_json(self._session_key(session_id, "tail"), tail)

    async def _load_agent_state_impl(self, session_id: str) -> dict | None:
        data = await self._load_json(self._session_key(session_id, "agent_state"), None)
        return data if isinstance(data, dict) else None

    async def _save_agent_state_impl(self, session_id: str, state: dict) -> None:
        await self._save_json(self._session_key(session_id, "agent_state"), state)

    async def _delete_session_impl(self, session_id: str) -> None:
        await self._ensure_connected_async()
        await self._rb.delete(
            self._session_key(session_id, "messages"),
            self._session_key(session_id, "agent_messages"),
            self._session_key(session_id, "tail"),
            self._session_key(session_id, "agent_state"),
        )

    async def _load_automation_tasks_impl(self) -> list[dict]:
        data = await self._load_json("automation:tasks", [])
        return data if isinstance(data, list) else []

    async def _save_automation_tasks_impl(self, tasks: list[dict]) -> None:
        await self._save_json("automation:tasks", tasks)

    async def _load_mcp_state_impl(self) -> dict:
        data = await self._load_json("mcp:state", {})
        return data if isinstance(data, dict) else {}

    async def _save_mcp_state_impl(self, state: dict) -> None:
        await self._save_json("mcp:state", state)

    async def _ping_impl(self) -> bool:
        await self._ensure_connected_async()
        return await self._rb.ping()
