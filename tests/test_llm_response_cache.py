#!/usr/bin/env python3
"""Tests for LLM response cache.

Author: Damon Li
"""

import time
import pytest
from agenticx.llms.response_cache import ResponseCache
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage


def _make_response(text: str) -> LLMResponse:
    return LLMResponse(
        id="test-id",
        model_name="test",
        created=0,
        content=text,
        choices=[LLMChoice(index=0, content=text)],
        token_usage=TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
    )


class TestResponseCache:
    def test_cache_hit(self):
        cache = ResponseCache(ttl_seconds=60)
        resp = _make_response("cached answer")
        cache.put("hello world", resp)
        hit = cache.get("hello world")
        assert hit is not None
        assert hit.content == "cached answer"

    def test_cache_miss(self):
        cache = ResponseCache(ttl_seconds=60)
        assert cache.get("unknown prompt") is None

    def test_cache_expiry(self):
        cache = ResponseCache(ttl_seconds=0.1)
        cache.put("key", _make_response("val"))
        time.sleep(0.2)
        assert cache.get("key") is None

    def test_cache_max_entries(self):
        cache = ResponseCache(ttl_seconds=60, max_entries=2)
        cache.put("a", _make_response("1"))
        cache.put("b", _make_response("2"))
        cache.put("c", _make_response("3"))
        assert cache.get("a") is None
        assert cache.get("c") is not None

    def test_stats(self):
        cache = ResponseCache(ttl_seconds=60)
        cache.put("q", _make_response("a"))
        cache.get("q")
        cache.get("miss")
        stats = cache.stats()
        assert stats["hits"] == 1
        assert stats["misses"] == 1
