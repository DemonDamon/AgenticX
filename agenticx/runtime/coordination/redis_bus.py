#!/usr/bin/env python3
"""Redis-backed coordination bus for multi-replica deployments (Plan C).

- Session locks: ``SET lock:sess:{sid} {owner} NX PX ttl`` with a heartbeat
  task renewing at ttl/3. Renew/release use a two-step GET-compare-then-act
  instead of Lua (fakeredis and some managed Redis proxies do not support
  ``EVAL``); the residual race window is documented on ``renew``/``release``.
- Cancel broadcast: pub/sub channel ``cancel`` carrying JSON
  ``{"session_id": ...}``; each replica dispatches to callbacks for sessions
  it actually hosts.
- Event replay log: per-session capped list ``ev:sess:{sid}`` with cursors
  from ``INCR ev:sess:{sid}:seq`` (monotonic, survives log trimming).

Connection reuse: all commands go through the shared
``agenticx.server.redis_backend.RedisBackend`` instance's client (the shared
backend lacks pub/sub/list primitives, so they are accessed via its client —
a single connection pool is kept). The client is loop-affine; the bus
(re)connects lazily on the currently running loop and reconnects when the
loop changes (e.g. fresh test loops).

Degradation: when Redis is unreachable, lock acquisition fails OPEN (a
degraded lock is granted, single-replica semantics) because a dead
coordination store must not block all chat traffic; a held lock whose renew
fails invokes ``on_lost`` so the owning turn interrupts itself instead of
double-writing.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable, Optional

from agenticx.server.redis_backend import RedisBackend as SharedRedisBackend

logger = logging.getLogger(__name__)

_EVENT_LOG_MAX_LEN = 1000
_CONNECT_RETRY_INTERVAL_SEC = 10.0


def _lock_key(session_id: str) -> str:
    return f"lock:sess:{session_id}"


def _event_key(session_id: str) -> str:
    return f"ev:sess:{session_id}"


def _event_seq_key(session_id: str) -> str:
    return f"ev:sess:{session_id}:seq"


class RedisSessionLock:
    """A held Redis session lock with heartbeat renewal."""

    def __init__(
        self,
        bus: "RedisBus",
        session_id: str,
        owner: str,
        ttl_ms: int,
        *,
        degraded: bool = False,
    ) -> None:
        self._bus = bus
        self.session_id = session_id
        self.owner = owner
        self._ttl_ms = ttl_ms
        self._degraded = degraded
        self._heartbeat_task: Optional[asyncio.Task] = None
        self.on_lost: Optional[Callable[[], Any]] = None

    async def start_heartbeat(self) -> None:
        if self._degraded or self._heartbeat_task is not None:
            return
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _heartbeat_loop(self) -> None:
        interval = max(1.0, self._ttl_ms / 3000.0)
        while True:
            await asyncio.sleep(interval)
            ok = await self.renew()
            if not ok:
                logger.warning(
                    "session lock lost session=%s owner=%s", self.session_id, self.owner
                )
                callback = self.on_lost
                if callable(callback):
                    try:
                        callback()
                    except Exception:
                        logger.warning("lock on_lost callback failed", exc_info=True)
                return

    async def renew(self) -> bool:
        """Extend the lease. False when the lock is lost or Redis is down.

        Two-step (GET compare + PEXPIRE) rather than Lua: between the two
        commands the lease could theoretically expire and be re-acquired by
        another owner, which we would then extend. The TTL (default 30s) makes
        that window practically unreachable; correctness on loss is preserved
        because the new owner's heartbeat keeps its own lease alive.
        """
        if self._degraded:
            return True
        client = await self._bus._client_or_none()
        if client is None:
            return False
        key = _lock_key(self.session_id)
        try:
            current = await client.get(self._bus._prefixed(key))
            if current != self.owner:
                return False
            return bool(await client.pexpire(self._bus._prefixed(key), self._ttl_ms))
        except Exception:
            logger.debug("lock renew failed session=%s", self.session_id, exc_info=True)
            return False

    async def release(self) -> None:
        """Release the lock; idempotent. Same two-step caveat as ``renew``."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        if self._degraded:
            return
        client = await self._bus._client_or_none()
        if client is None:
            return
        key = self._bus._prefixed(_lock_key(self.session_id))
        try:
            current = await client.get(key)
            if current == self.owner:
                await client.delete(key)
        except Exception:
            logger.debug("lock release failed session=%s", self.session_id, exc_info=True)

    async def __aenter__(self) -> "RedisSessionLock":
        await self.start_heartbeat()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.release()


class RedisBus:
    """``CoordinationBus`` implementation over Redis."""

    def __init__(
        self,
        *,
        redis_backend: SharedRedisBackend | None = None,
        url: str | None = None,
    ) -> None:
        self._rb = redis_backend or SharedRedisBackend(url=url)
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._last_connect_attempt = 0.0
        self._cancel_callbacks: list[Callable[[str], Awaitable[None]]] = []
        self._cancel_listener_task: Optional[asyncio.Task] = None
        self._cancel_ready: Optional[asyncio.Event] = None

    # ── connection ──

    def _prefixed(self, key: str) -> str:
        return self._rb._key(key)

    async def _client_or_none(self) -> Any | None:
        loop = asyncio.get_running_loop()
        if self._rb.connected:
            if self._loop is None or self._loop is loop:
                self._loop = loop
                return self._rb._client
            # Loop changed (fresh test loop, etc.): reconnect on the new loop.
            try:
                await self._rb.close()
            except Exception:
                pass
        now = time.monotonic()
        if (now - self._last_connect_attempt) < _CONNECT_RETRY_INTERVAL_SEC:
            return None
        self._last_connect_attempt = now
        try:
            await self._rb.connect()
        except Exception:
            logger.warning("coordination bus connect failed", exc_info=True)
            return None
        if not self._rb.connected:
            return None
        self._loop = loop
        return self._rb._client

    async def close(self) -> None:
        if self._cancel_listener_task is not None:
            self._cancel_listener_task.cancel()
            self._cancel_listener_task = None
        try:
            await self._rb.close()
        except Exception:
            pass

    # ── locks ──

    async def acquire_session_lock(
        self,
        session_id: str,
        *,
        owner: str,
        ttl_ms: int = 30000,
    ) -> RedisSessionLock | None:
        client = await self._client_or_none()
        if client is None:
            # Fail open: a dead coordination store must not block all chat.
            logger.warning(
                "redis unavailable; granting degraded session lock session=%s", session_id
            )
            return RedisSessionLock(self, session_id, owner, ttl_ms, degraded=True)
        key = self._prefixed(_lock_key(session_id))
        try:
            current = await client.get(key)
            if current == owner:
                # Re-entrant acquire by the same replica (duplicate-turn guard
                # still applies inside the process).
                return RedisSessionLock(self, session_id, owner, ttl_ms)
            acquired = await client.set(key, owner, nx=True, px=ttl_ms)
        except Exception:
            logger.warning("lock acquire failed session=%s", session_id, exc_info=True)
            return RedisSessionLock(self, session_id, owner, ttl_ms, degraded=True)
        if not acquired:
            return None
        lock = RedisSessionLock(self, session_id, owner, ttl_ms)
        await lock.start_heartbeat()
        return lock

    # ── cancel broadcast ──

    async def publish_cancel(self, session_id: str) -> None:
        client = await self._client_or_none()
        if client is None:
            return
        try:
            await client.publish(
                self._prefixed("cancel"),
                json.dumps({"session_id": session_id}, ensure_ascii=False),
            )
        except Exception:
            logger.warning("cancel publish failed session=%s", session_id, exc_info=True)

    async def subscribe_cancel(
        self,
        callback: Callable[[str], Awaitable[None]],
    ) -> None:
        self._cancel_callbacks.append(callback)
        if self._cancel_ready is None:
            self._cancel_ready = asyncio.Event()
        if self._cancel_listener_task is None or self._cancel_listener_task.done():
            self._cancel_listener_task = asyncio.create_task(self._cancel_listener())

    async def wait_cancel_ready(self, timeout: float = 5.0) -> bool:
        """Wait until the cancel subscription is active (pub/sub is fire-and-forget)."""
        if self._cancel_ready is None:
            return False
        try:
            await asyncio.wait_for(self._cancel_ready.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

    async def _cancel_listener(self) -> None:
        while True:
            client = await self._client_or_none()
            if client is None:
                await asyncio.sleep(2.0)
                # Keep retrying; _client_or_none throttles actual reconnects.
                continue
            pubsub = client.pubsub()
            try:
                await pubsub.subscribe(self._prefixed("cancel"))
                if self._cancel_ready is not None:
                    self._cancel_ready.set()
                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if message is None:
                        continue
                    try:
                        payload = json.loads(str(message.get("data") or "{}"))
                    except (TypeError, json.JSONDecodeError):
                        continue
                    sid = str(payload.get("session_id") or "").strip()
                    if not sid:
                        continue
                    for callback in list(self._cancel_callbacks):
                        try:
                            await callback(sid)
                        except Exception:
                            logger.warning("cancel callback failed", exc_info=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("cancel listener error; reconnecting", exc_info=True)
                await asyncio.sleep(2.0)
            finally:
                try:
                    await pubsub.aclose()
                except Exception:
                    pass

    # ── event replay log ──

    async def event_append(self, session_id: str, event: dict) -> str:
        client = await self._client_or_none()
        if client is None:
            return ""
        seq_key = self._prefixed(_event_seq_key(session_id))
        log_key = self._prefixed(_event_key(session_id))
        try:
            seq = await client.incr(seq_key)
            payload = json.dumps({"seq": seq, "event": event}, ensure_ascii=False, default=str)
            pipe = client.pipeline(transaction=False)
            pipe.rpush(log_key, payload)
            pipe.ltrim(log_key, -_EVENT_LOG_MAX_LEN, -1)
            await pipe.execute()
            return str(seq)
        except Exception:
            logger.debug("event append failed session=%s", session_id, exc_info=True)
            return ""

    async def event_read(
        self,
        session_id: str,
        *,
        since: str | None = None,
        limit: int = 1000,
    ) -> list[tuple[str, dict]]:
        client = await self._client_or_none()
        if client is None:
            return []
        try:
            since_seq = int(since) if since else 0
        except (TypeError, ValueError):
            since_seq = 0
        log_key = self._prefixed(_event_key(session_id))
        try:
            rows = await client.lrange(log_key, 0, -1)
        except Exception:
            logger.debug("event read failed session=%s", session_id, exc_info=True)
            return []
        out: list[tuple[str, dict]] = []
        for raw in rows:
            try:
                item = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            seq = int(item.get("seq") or 0)
            event = item.get("event")
            if seq > since_seq and isinstance(event, dict):
                out.append((str(seq), event))
            if len(out) >= max(1, int(limit)):
                break
        return out

    async def event_trim(self, session_id: str, *, max_len: int = 1000) -> None:
        client = await self._client_or_none()
        if client is None:
            return
        try:
            await client.ltrim(
                self._prefixed(_event_key(session_id)), -max(1, int(max_len)), -1
            )
        except Exception:
            logger.debug("event trim failed session=%s", session_id, exc_info=True)

    async def ping(self) -> bool:
        client = await self._client_or_none()
        if client is None:
            return False
        return await self._rb.ping()
