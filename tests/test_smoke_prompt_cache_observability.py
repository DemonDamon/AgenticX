#!/usr/bin/env python3
"""P0: cached_tokens must be observable end-to-end.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.llms.response import TokenUsage
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response
from agenticx.runtime.usage_store import UsageStore


def test_token_usage_cached_tokens_roundtrip() -> None:
    assert TokenUsage(cached_tokens=123).cached_tokens == 123
    assert TokenUsage().cached_tokens == 0
    leftover = TokenUsage(prompt_tokens=1, completion_tokens=2, total_tokens=3)
    assert leftover.prompt_tokens == 1
    assert leftover.completion_tokens == 2
    assert leftover.total_tokens == 3
    assert leftover.cached_tokens == 0


def test_usage_metadata_reads_prompt_tokens_details() -> None:
    usage = {
        "prompt_tokens": 1000,
        "completion_tokens": 10,
        "total_tokens": 1010,
        "prompt_tokens_details": {"cached_tokens": 768},
    }
    resp = SimpleNamespace(token_usage=None, usage=usage, metadata={})
    meta = usage_metadata_from_llm_response(resp)
    assert meta is not None
    assert meta["cached_tokens"] == 768
    assert meta["input_tokens"] == 1000


def test_usage_metadata_falls_back_when_token_usage_is_trimmed() -> None:
    trimmed = TokenUsage(prompt_tokens=1000, completion_tokens=10, total_tokens=1010)
    usage = {
        "prompt_tokens": 1000,
        "completion_tokens": 10,
        "total_tokens": 1010,
        "prompt_tokens_details": {"cached_tokens": 512},
    }
    resp = SimpleNamespace(token_usage=trimmed, usage=usage, metadata={})
    meta = usage_metadata_from_llm_response(resp)
    assert meta is not None
    assert meta["cached_tokens"] == 512
    assert meta["input_tokens"] == 1000


def test_usage_store_cache_stats(tmp_path) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    store.record_sync(
        session_id="s1",
        avatar_id="",
        provider="kimi",
        model="kimi-k2.6",
        input_tokens=2000,
        output_tokens=20,
        cached_tokens=768,
        reasoning_tokens=0,
        total_tokens=2020,
    )
    store.record_sync(
        session_id="s2",
        avatar_id="",
        provider="kimi",
        model="kimi-k2.6",
        input_tokens=4000,
        output_tokens=10,
        cached_tokens=0,
        reasoning_tokens=0,
        total_tokens=4010,
    )
    s1 = store.cache_stats(session_id="s1")
    assert s1["input_tokens"] == 2000
    assert s1["cached_tokens"] == 768
    assert s1["requests"] == 1
    assert s1["last_input_tokens"] == 2000
    assert s1["last_cached_tokens"] == 768
    assert abs(s1["last_cache_ratio"] - 768 / 2000) < 1e-9
    s2 = store.cache_stats(session_id="s2")
    assert s2["cached_tokens"] == 0
    assert s2["last_cache_ratio"] == 0.0
    assert s2["zero_cache_requests"] == 1
    all_stats = store.cache_stats()
    assert all_stats["input_tokens"] == 6000
    assert all_stats["cached_tokens"] == 768
    assert all_stats["requests"] == 2
    assert all_stats["last_input_tokens"] == 0
    assert all_stats["last_cached_tokens"] == 0
    store.record_sync(
        session_id="s1",
        avatar_id="",
        provider="kimi",
        model="kimi-k2.6",
        input_tokens=3000,
        output_tokens=20,
        cached_tokens=512,
        reasoning_tokens=0,
        total_tokens=3020,
    )
    s1_next = store.cache_stats(session_id="s1")
    assert s1_next["cached_tokens"] == 768 + 512
    assert s1_next["last_input_tokens"] == 3000
    assert s1_next["last_cached_tokens"] == 512


def test_litellm_parse_response_keeps_cached_tokens() -> None:
    usage = SimpleNamespace(
        prompt_tokens=1000,
        completion_tokens=10,
        total_tokens=1010,
        prompt_tokens_details=SimpleNamespace(cached_tokens=256),
        completion_tokens_details=None,
    )
    choice = SimpleNamespace(
        index=0,
        finish_reason="stop",
        message=SimpleNamespace(content="ok", tool_calls=None, reasoning_content=None),
    )
    response = SimpleNamespace(
        id="chatcmpl-cache",
        model="kimi-k2.6",
        created=1,
        usage=usage,
        choices=[choice],
        completion_cost=0.0,
        _hidden_params={},
        _response_ms=1,
        custom_llm_provider="openai",
    )
    provider = LiteLLMProvider(model="kimi-k2.6")
    parsed = provider._parse_response(response)
    assert parsed.token_usage.cached_tokens == 256
