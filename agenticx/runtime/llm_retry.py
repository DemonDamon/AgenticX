#!/usr/bin/env python3
"""Unified LLM call retry layer with exponential backoff.

Wraps LLM invoke/stream calls with rate-limit (429), server-error (5xx),
and timeout-aware retry logic for the Studio main path.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import time
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

_log = logging.getLogger(__name__)

T = TypeVar("T")

_RATE_LIMIT_PATTERNS = re.compile(
    r"429|rate.?limit|too many requests|quota exceeded|resource_exhausted",
    re.IGNORECASE,
)
_SERVER_ERROR_PATTERNS = re.compile(
    r"50[0-9]|internal.?server.?error|service.?unavailable|bad.?gateway|overloaded",
    re.IGNORECASE,
)


def _classify_error(exc: BaseException) -> str:
    """Classify an LLM error into rate_limit / server_error / timeout / unknown."""
    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    msg = str(exc)
    status_code = getattr(exc, "status_code", None)
    if status_code == 429 or _RATE_LIMIT_PATTERNS.search(msg):
        return "rate_limit"
    if (isinstance(status_code, int) and 500 <= status_code < 600) or _SERVER_ERROR_PATTERNS.search(msg):
        return "server_error"
    return "unknown"


def _resolve_retry_config() -> Dict[str, int]:
    """Read retry budgets from env or defaults."""
    def _env_int(key: str, default: int) -> int:
        raw = os.environ.get(key, "").strip()
        if raw:
            try:
                return max(0, int(raw))
            except ValueError:
                pass
        return default

    return {
        "rate_limit": _env_int("AGX_LLM_RETRY_RATE_LIMIT", 3),
        "server_error": _env_int("AGX_LLM_RETRY_SERVER_ERROR", 2),
        "timeout": _env_int("AGX_LLM_RETRY_TIMEOUT", 1),
    }


class LLMRetryPolicy:
    """Configurable retry policy for LLM calls.

    Supports per-category retry budgets with jittered exponential backoff.
    Emits optional event callbacks so the runtime can push SSE updates.
    """

    def __init__(
        self,
        *,
        base_delay: float = 2.0,
        max_delay: float = 60.0,
        on_retry: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.on_retry = on_retry
        self._config = _resolve_retry_config()

    def _backoff(self, attempt: int) -> float:
        """Jittered exponential backoff."""
        delay = min(self.base_delay * (2 ** attempt), self.max_delay)
        jitter = random.uniform(0, delay * 0.3)
        return delay + jitter

    async def call_with_retry(
        self,
        fn: Callable[..., Awaitable[T]],
        *args: Any,
        **kwargs: Any,
    ) -> T:
        """Execute *fn* with automatic retries on transient errors.

        Non-retryable errors (unknown category or budget exhausted) are
        re-raised immediately.
        """
        last_exc: Optional[BaseException] = None
        attempts_by_category: Dict[str, int] = {}

        for attempt in range(1, 20):
            try:
                return await fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                category = _classify_error(exc)
                max_retries = self._config.get(category, 0)
                attempts_by_category[category] = attempts_by_category.get(category, 0) + 1
                current_attempt = attempts_by_category[category]

                if current_attempt > max_retries:
                    _log.warning(
                        "LLM call failed (%s), retries exhausted (%d/%d): %s",
                        category, current_attempt, max_retries, exc,
                    )
                    raise

                wait_sec = self._backoff(current_attempt - 1)
                _log.info(
                    "LLM call failed (%s), retry %d/%d in %.1fs: %s",
                    category, current_attempt, max_retries, wait_sec, exc,
                )

                if self.on_retry:
                    try:
                        self.on_retry({
                            "attempt": current_attempt,
                            "max_retries": max_retries,
                            "category": category,
                            "wait_seconds": round(wait_sec, 1),
                            "error": str(exc)[:200],
                        })
                    except Exception:
                        pass

                await asyncio.sleep(wait_sec)

        if last_exc is not None:
            raise last_exc
        raise RuntimeError("LLM retry loop ended unexpectedly")

    def call_sync_with_retry(
        self,
        fn: Callable[..., T],
        *args: Any,
        **kwargs: Any,
    ) -> T:
        """Synchronous variant of call_with_retry for thread-pool usage.

        Uses time.sleep instead of asyncio.sleep — safe for use inside
        asyncio.to_thread / run_in_executor.
        """
        last_exc: Optional[BaseException] = None
        attempts_by_category: Dict[str, int] = {}

        for attempt in range(1, 20):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                category = _classify_error(exc)
                max_retries = self._config.get(category, 0)
                attempts_by_category[category] = attempts_by_category.get(category, 0) + 1
                current_attempt = attempts_by_category[category]

                if current_attempt > max_retries:
                    _log.warning(
                        "LLM sync call failed (%s), retries exhausted (%d/%d): %s",
                        category, current_attempt, max_retries, exc,
                    )
                    raise

                wait_sec = self._backoff(current_attempt - 1)
                _log.info(
                    "LLM sync call failed (%s), retry %d/%d in %.1fs: %s",
                    category, current_attempt, max_retries, wait_sec, exc,
                )

                if self.on_retry:
                    try:
                        self.on_retry({
                            "attempt": current_attempt,
                            "max_retries": max_retries,
                            "category": category,
                            "wait_seconds": round(wait_sec, 1),
                            "error": str(exc)[:200],
                        })
                    except Exception:
                        pass

                time.sleep(wait_sec)

        if last_exc is not None:
            raise last_exc
        raise RuntimeError("LLM sync retry loop ended unexpectedly")
