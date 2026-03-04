#!/usr/bin/env python3
"""Retry, graceful degradation, and idempotency for AgenticX server.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar

from agenticx.core.error_handler import is_retryable

logger = logging.getLogger(__name__)

T = TypeVar("T")
_PENDING = object()
_PENDING_SENTINEL = "__PENDING__"


class IdempotencyStore:
    """In-memory idempotency store to prevent duplicate submissions.

    TTL-based expiry. For production, use RedisIdempotencyStore.
    """

    def __init__(self, ttl_seconds: float = 300.0, max_entries: int = 10000) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._store: Dict[str, tuple[Any, float]] = {}

    def _evict_expired(self) -> None:
        now = time.time()
        expired = [k for k, (_, ts) in self._store.items() if now - ts > self._ttl]
        for k in expired:
            del self._store[k]
        if len(self._store) > self._max_entries:
            oldest = sorted(self._store.items(), key=lambda x: x[1][1])[: len(self._store) - self._max_entries]
            for k, _ in oldest:
                del self._store[k]

    def set_if_absent(self, key: str, value: Any = True) -> bool:
        """Set key if not present. Returns True if set, False if already exists."""
        self._evict_expired()
        if key in self._store:
            return False
        self._store[key] = (value, time.time())
        return True

    def get(self, key: str) -> Optional[Any]:
        """Get value by key. Returns None if expired or not found."""
        self._evict_expired()
        entry = self._store.get(key)
        if not entry:
            return None
        val, ts = entry
        if time.time() - ts > self._ttl:
            del self._store[key]
            return None
        return val

    def delete(self, key: str) -> bool:
        """Delete key. Returns True if deleted."""
        if key in self._store:
            del self._store[key]
            return True
        return False

    def set(self, key: str, value: Any) -> None:
        """Set or overwrite key with value."""
        self._evict_expired()
        self._store[key] = (value, time.time())


class RedisIdempotencyStore:
    """Redis-backed idempotency store for multi-instance deployments.

    Uses SET NX EX for atomic check-and-set with automatic TTL expiry.
    Falls back to in-memory IdempotencyStore on Redis failure.
    """

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self._ttl = ttl_seconds
        self._fallback = IdempotencyStore(ttl_seconds=ttl_seconds)
        self._prefix = "idem:"

    def _get_backend(self):
        from agenticx.server.redis_backend import get_redis_backend
        return get_redis_backend()

    async def set_if_absent(self, key: str, value: Any = True) -> bool:
        """Atomic set-if-not-exists. Returns True if set."""
        backend = self._get_backend()
        if backend and backend.connected:
            serialized = _PENDING_SENTINEL if value is _PENDING else json.dumps(value)
            return await backend.set(
                f"{self._prefix}{key}", serialized, ex=int(self._ttl), nx=True
            )
        return self._fallback.set_if_absent(key, value)

    async def get(self, key: str) -> Optional[Any]:
        """Get value. Returns None if not found or expired."""
        backend = self._get_backend()
        if backend and backend.connected:
            raw = await backend.get(f"{self._prefix}{key}")
            if raw is None:
                return None
            if raw == _PENDING_SENTINEL:
                return _PENDING
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw
        return self._fallback.get(key)

    async def delete(self, key: str) -> bool:
        """Delete key."""
        backend = self._get_backend()
        if backend and backend.connected:
            return (await backend.delete(f"{self._prefix}{key}")) > 0
        return self._fallback.delete(key)

    async def set(self, key: str, value: Any) -> None:
        """Set or overwrite."""
        backend = self._get_backend()
        if backend and backend.connected:
            serialized = json.dumps(value)
            await backend.set(f"{self._prefix}{key}", serialized, ex=int(self._ttl))
            return
        self._fallback.set(key, value)


class GracefulDegradation:
    """Manage degradation state. Expose via /health/ready."""

    def __init__(self) -> None:
        self._degraded: Dict[str, str] = {}
        self._llm_available = True
        self._cache_enabled = False

    def set_llm_available(self, available: bool) -> None:
        self._llm_available = available

    def set_degraded(self, component: str, reason: str) -> None:
        self._degraded[component] = reason

    def clear_degraded(self, component: Optional[str] = None) -> None:
        if component:
            self._degraded.pop(component, None)
        else:
            self._degraded.clear()

    def get_status(self) -> Dict[str, Any]:
        return {
            "llm_available": self._llm_available,
            "degraded_components": dict(self._degraded),
            "cache_enabled": self._cache_enabled,
        }

    def is_healthy(self) -> bool:
        return self._llm_available and len(self._degraded) == 0


_default_idempotency: Optional[Any] = None
_default_degradation: Optional[GracefulDegradation] = None


def get_idempotency_store() -> Any:
    """Get the idempotency store (Redis-backed if available, else in-memory)."""
    global _default_idempotency
    if _default_idempotency is None:
        from agenticx.server.redis_backend import get_redis_backend
        backend = get_redis_backend()
        if backend and backend.connected:
            _default_idempotency = RedisIdempotencyStore()
        else:
            _default_idempotency = IdempotencyStore()
    return _default_idempotency


def get_graceful_degradation() -> GracefulDegradation:
    global _default_degradation
    if _default_degradation is None:
        _default_degradation = GracefulDegradation()
    return _default_degradation


async def _store_get(store: Any, key: str) -> Optional[Any]:
    """Unified get: handles both sync IdempotencyStore and async RedisIdempotencyStore."""
    result = store.get(key)
    if asyncio.iscoroutine(result):
        return await result
    return result


async def _store_set_if_absent(store: Any, key: str, value: Any) -> bool:
    result = store.set_if_absent(key, value)
    if asyncio.iscoroutine(result):
        return await result
    return result


async def _store_delete(store: Any, key: str) -> bool:
    result = store.delete(key)
    if asyncio.iscoroutine(result):
        return await result
    return result


async def _store_set(store: Any, key: str, value: Any) -> None:
    result = store.set(key, value)
    if asyncio.iscoroutine(result):
        await result


def retryable_endpoint(
    max_attempts: int = 3,
    idempotency_header: str = "Idempotency-Key",
) -> Callable:
    """Decorator for retryable endpoints. Uses is_retryable() for error classification."""

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = None
            for a in args:
                if hasattr(a, "headers"):
                    request = a
                    break
            idem_key = None
            if request and hasattr(request, "headers"):
                idem_key = request.headers.get(idempotency_header)
            if idem_key:
                store = get_idempotency_store()
                cached = await _store_get(store, idem_key)
                if cached is not None and cached is not _PENDING:
                    return cached
                if not await _store_set_if_absent(store, idem_key, _PENDING):
                    await asyncio.sleep(0.1)
                    cached = await _store_get(store, idem_key)
                    if cached is not None and cached is not _PENDING:
                        return cached
            last_error = None
            for attempt in range(max_attempts):
                try:
                    result = func(*args, **kwargs)
                    if asyncio.iscoroutine(result):
                        result = await result
                    if idem_key:
                        store = get_idempotency_store()
                        await _store_delete(store, idem_key)
                        await _store_set(store, idem_key, result)
                    return result
                except Exception as e:
                    last_error = e
                    if not is_retryable(e) or attempt == max_attempts - 1:
                        raise
                    delay = 0.5 * (2 ** attempt)
                    logger.debug("RetryableEndpoint attempt %s failed, retry in %s: %s", attempt + 1, delay, e)
                    await asyncio.sleep(delay)
            raise last_error  # type: ignore

        return wrapper

    return decorator


def RetryableEndpoint(
    max_attempts: int = 3,
    idempotency_header: str = "Idempotency-Key",
) -> Callable:
    """Alias for retryable_endpoint (class-style name)."""
    return retryable_endpoint(max_attempts=max_attempts, idempotency_header=idempotency_header)
