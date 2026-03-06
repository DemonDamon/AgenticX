#!/usr/bin/env python3
"""In-memory LLM response cache with TTL and LRU eviction.

Caches LLM responses keyed by prompt hash. Saves tokens on repeated
prompts within a session.

Internalized from IronClaw src/llm/response_cache.rs.

Author: Damon Li
"""

import hashlib
import logging
import time
from collections import OrderedDict
from typing import Optional, Union

from agenticx.llms.response import LLMResponse

logger = logging.getLogger(__name__)


class ResponseCache:
    """In-memory LLM response cache with TTL and LRU eviction."""

    def __init__(self, ttl_seconds: Union[int, float] = 300, max_entries: int = 100):
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._cache: OrderedDict[str, tuple[float, LLMResponse]] = OrderedDict()
        self._hits = 0
        self._misses = 0

    def _make_key(self, prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()[:32]

    def get(self, prompt: str) -> Optional[LLMResponse]:
        """Look up a cached response. Returns None on miss or expiry."""
        key = self._make_key(prompt)
        entry = self._cache.get(key)
        if entry is None:
            self._misses += 1
            return None
        ts, response = entry
        if time.monotonic() - ts > self._ttl:
            del self._cache[key]
            self._misses += 1
            return None
        self._cache.move_to_end(key)
        self._hits += 1
        return response

    def put(self, prompt: str, response: LLMResponse) -> None:
        """Store a response in the cache."""
        key = self._make_key(prompt)
        self._cache[key] = (time.monotonic(), response)
        self._cache.move_to_end(key)
        while len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)

    def invalidate(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()

    def stats(self) -> dict:
        """Return cache hit/miss statistics."""
        return {
            "hits": self._hits,
            "misses": self._misses,
            "size": len(self._cache),
            "hit_rate": self._hits / max(1, self._hits + self._misses),
        }
