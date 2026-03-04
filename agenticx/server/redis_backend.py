#!/usr/bin/env python3
"""Redis shared-state backend for horizontal scaling.

Provides a unified Redis connection pool used by rate limiting, circuit breaker,
idempotency store, and task queue. Falls back to in-memory when Redis is unavailable.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as aioredis  # type: ignore
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    aioredis = None  # type: ignore


class RedisBackend:
    """Async Redis backend with connection pooling and graceful fallback.

    All methods are safe to call even if Redis is unavailable — they return
    sensible defaults and log warnings instead of raising.
    """

    def __init__(
        self,
        url: Optional[str] = None,
        key_prefix: str = "agenticx:",
        decode_responses: bool = True,
        max_connections: int = 20,
        socket_timeout: float = 5.0,
        socket_connect_timeout: float = 5.0,
    ) -> None:
        self._url = url or os.environ.get(
            "AGENTICX_REDIS_URL",
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        )
        self._key_prefix = key_prefix
        self._client: Optional[aioredis.Redis] = None  # type: ignore[name-defined]
        self._connected = False
        self._decode_responses = decode_responses
        self._max_connections = max_connections
        self._socket_timeout = socket_timeout
        self._socket_connect_timeout = socket_connect_timeout

    def _key(self, key: str) -> str:
        return f"{self._key_prefix}{key}"

    @property
    def connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        """Establish connection. Returns True if successful."""
        if not REDIS_AVAILABLE:
            logger.warning("redis package not installed — running in memory-only mode")
            return False
        try:
            self._client = aioredis.from_url(
                self._url,
                decode_responses=self._decode_responses,
                max_connections=self._max_connections,
                socket_timeout=self._socket_timeout,
                socket_connect_timeout=self._socket_connect_timeout,
            )
            await self._client.ping()
            self._connected = True
            logger.info("Redis backend connected: %s", self._url.split("@")[-1])
            return True
        except Exception as e:
            logger.warning("Redis connection failed, falling back to memory: %s", e)
            self._client = None
            self._connected = False
            return False

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
            self._connected = False

    async def ping(self) -> bool:
        if not self._client:
            return False
        try:
            return await self._client.ping()
        except Exception:
            self._connected = False
            return False

    # ── Scalar operations ──

    async def get(self, key: str) -> Optional[str]:
        if not self._client:
            return None
        try:
            return await self._client.get(self._key(key))
        except Exception as e:
            logger.debug("Redis GET failed for %s: %s", key, e)
            return None

    async def set(
        self,
        key: str,
        value: str,
        ex: Optional[int] = None,
        nx: bool = False,
    ) -> bool:
        if not self._client:
            return False
        try:
            result = await self._client.set(self._key(key), value, ex=ex, nx=nx)
            return bool(result)
        except Exception as e:
            logger.debug("Redis SET failed for %s: %s", key, e)
            return False

    async def delete(self, *keys: str) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.delete(*(self._key(k) for k in keys))
        except Exception:
            return 0

    async def incr(self, key: str) -> Optional[int]:
        if not self._client:
            return None
        try:
            return await self._client.incr(self._key(key))
        except Exception:
            return None

    async def expire(self, key: str, seconds: int) -> bool:
        if not self._client:
            return False
        try:
            return await self._client.expire(self._key(key), seconds)
        except Exception:
            return False

    # ── Hash operations ──

    async def hset(self, name: str, mapping: Dict[str, str]) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.hset(self._key(name), mapping=mapping)
        except Exception:
            return 0

    async def hget(self, name: str, field: str) -> Optional[str]:
        if not self._client:
            return None
        try:
            return await self._client.hget(self._key(name), field)
        except Exception:
            return None

    async def hgetall(self, name: str) -> Dict[str, str]:
        if not self._client:
            return {}
        try:
            return await self._client.hgetall(self._key(name))
        except Exception:
            return {}

    async def hdel(self, name: str, *fields: str) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.hdel(self._key(name), *fields)
        except Exception:
            return 0

    # ── Sorted Set operations (for sliding window rate limiting) ──

    async def zadd(self, name: str, mapping: Dict[str, float]) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.zadd(self._key(name), mapping)
        except Exception:
            return 0

    async def zremrangebyscore(
        self, name: str, min_score: float, max_score: float
    ) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.zremrangebyscore(
                self._key(name), min_score, max_score
            )
        except Exception:
            return 0

    async def zcard(self, name: str) -> int:
        if not self._client:
            return 0
        try:
            return await self._client.zcard(self._key(name))
        except Exception:
            return 0

    async def zrangebyscore(
        self,
        name: str,
        min_score: float = float("-inf"),
        max_score: float = float("+inf"),
        start: int = 0,
        num: int = -1,
        withscores: bool = False,
    ) -> list:
        if not self._client:
            return []
        try:
            return await self._client.zrangebyscore(
                self._key(name),
                min_score,
                max_score,
                start=start,
                num=num,
                withscores=withscores,
            )
        except Exception:
            return []

    # ── Pipeline / atomic operations ──

    async def rate_limit_sliding_window(
        self,
        key: str,
        max_requests: int,
        window_seconds: float,
    ) -> Tuple[bool, int, float]:
        """Atomic sliding-window rate limit check.

        Returns (allowed, remaining, reset_time).
        Uses MULTI/EXEC for atomicity.
        """
        if not self._client:
            return True, max_requests, time.time() + window_seconds

        now = time.time()
        window_start = now - window_seconds
        full_key = self._key(key)

        try:
            pipe = self._client.pipeline(transaction=True)
            pipe.zremrangebyscore(full_key, 0, window_start)
            pipe.zcard(full_key)
            pipe.zadd(full_key, {f"{now}:{id(pipe)}": now})
            pipe.expire(full_key, int(window_seconds) + 1)
            results = await pipe.execute()

            current_count = results[1]
            if current_count >= max_requests:
                await self._client.zrem(full_key, f"{now}:{id(pipe)}")
                return False, 0, now + window_seconds
            remaining = max(0, max_requests - current_count - 1)
            return True, remaining, now + window_seconds
        except Exception as e:
            logger.debug("Redis rate_limit_sliding_window failed: %s", e)
            return True, max_requests, time.time() + window_seconds

    async def circuit_breaker_state(
        self, endpoint_key: str
    ) -> Dict[str, Any]:
        """Get circuit breaker state from Redis Hash."""
        data = await self.hgetall(f"cb:{endpoint_key}")
        if not data:
            return {
                "state": "closed",
                "failure_count": 0,
                "last_failure_time": 0.0,
                "success_count": 0,
            }
        return {
            "state": data.get("state", "closed"),
            "failure_count": int(data.get("failure_count", 0)),
            "last_failure_time": float(data.get("last_failure_time", 0)),
            "success_count": int(data.get("success_count", 0)),
        }

    async def circuit_breaker_record_failure(
        self, endpoint_key: str, failure_threshold: int, recovery_timeout: int
    ) -> str:
        """Record failure and return new state."""
        hkey = self._key(f"cb:{endpoint_key}")
        if not self._client:
            return "closed"
        try:
            pipe = self._client.pipeline(transaction=True)
            pipe.hincrby(hkey, "failure_count", 1)
            pipe.hset(hkey, mapping={"last_failure_time": str(time.time())})
            pipe.hget(hkey, "failure_count")
            results = await pipe.execute()
            count = int(results[2] or 0)
            if count >= failure_threshold:
                await self._client.hset(hkey, mapping={"state": "open"})
                await self._client.expire(hkey, recovery_timeout * 3)
                return "open"
            return "closed"
        except Exception:
            return "closed"

    async def circuit_breaker_record_success(self, endpoint_key: str) -> None:
        """Record success — reset to closed."""
        hkey = self._key(f"cb:{endpoint_key}")
        if not self._client:
            return
        try:
            await self._client.hset(
                hkey,
                mapping={"state": "closed", "failure_count": "0", "success_count": "0"},
            )
        except Exception:
            pass

    # ── Task state persistence ──

    async def save_task(self, task_id: str, task_data: Dict[str, Any]) -> bool:
        """Persist task metadata to Redis Hash."""
        serialized = {k: json.dumps(v) if not isinstance(v, str) else v for k, v in task_data.items()}
        result = await self.hset(f"task:{task_id}", serialized)
        await self.expire(f"task:{task_id}", 86400)  # 24h TTL
        return result > 0

    async def load_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Load task metadata from Redis."""
        data = await self.hgetall(f"task:{task_id}")
        if not data:
            return None
        deserialized = {}
        for k, v in data.items():
            try:
                deserialized[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                deserialized[k] = v
        return deserialized

    async def add_task_to_index(self, task_id: str, created_at: float) -> None:
        """Add task to sorted set index for listing."""
        await self.zadd("task_index", {task_id: created_at})

    async def list_task_ids(
        self, limit: int = 100, offset: int = 0
    ) -> List[str]:
        """List task IDs ordered by creation time (newest first)."""
        if not self._client:
            return []
        try:
            full_key = self._key("task_index")
            return await self._client.zrevrange(full_key, offset, offset + limit - 1)
        except Exception:
            return []


# ── Singleton ──

_default_backend: Optional[RedisBackend] = None


async def init_redis_backend(
    url: Optional[str] = None, **kwargs: Any
) -> RedisBackend:
    """Initialize and connect the global Redis backend."""
    global _default_backend
    backend = RedisBackend(url=url, **kwargs)
    await backend.connect()
    _default_backend = backend
    return backend


def get_redis_backend() -> Optional[RedisBackend]:
    """Get the global Redis backend (may be None if not initialized)."""
    return _default_backend


def set_redis_backend(backend: Optional[RedisBackend]) -> None:
    """Set custom Redis backend (for testing)."""
    global _default_backend
    _default_backend = backend
