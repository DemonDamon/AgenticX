#!/usr/bin/env python3
"""Streaming usage must keep cached/reasoning tokens for every vendor.

Desktop chat records ledger rows from stream usage chunks. Providers used to
yield only prompt/completion/total, so cache hit rate stayed 0% even when the
vendor returned prompt_tokens_details.cached_tokens.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import agenticx.llms.litellm_provider as litellm_provider_module
from agenticx.llms.ark_provider import ArkLLMProvider
from agenticx.llms.bailian_provider import BailianProvider
from agenticx.llms.kimi_provider import KimiProvider
from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.runtime.usage_metadata import (
    normalize_stream_usage,
    usage_metadata_from_llm_response,
)


def test_normalize_stream_usage_minimax_prompt_tokens_details() -> None:
    usage = SimpleNamespace(
        prompt_tokens=23445,
        completion_tokens=190,
        total_tokens=23635,
        cached_tokens=0,
        prompt_tokens_details=SimpleNamespace(cached_tokens=22000),
        completion_tokens_details=SimpleNamespace(reasoning_tokens=80),
    )
    out = normalize_stream_usage(usage)
    assert out == {
        "prompt_tokens": 23445,
        "completion_tokens": 190,
        "total_tokens": 23635,
        "cached_tokens": 22000,
        "reasoning_tokens": 80,
    }


def test_normalize_stream_usage_kimi_flat_cached_tokens() -> None:
    out = normalize_stream_usage(
        {"prompt_tokens": 1000, "completion_tokens": 10, "total_tokens": 1010, "cached_tokens": 768}
    )
    assert out is not None
    assert out["cached_tokens"] == 768


def test_normalize_stream_usage_anthropic_cache_read() -> None:
    out = normalize_stream_usage(
        {
            "prompt_tokens": 2000,
            "completion_tokens": 20,
            "total_tokens": 2020,
            "cache_read_input_tokens": 1500,
        }
    )
    assert out is not None
    assert out["cached_tokens"] == 1500


def test_normalize_stream_usage_dashscope_input_tokens_details() -> None:
    out = normalize_stream_usage(
        {
            "prompt_tokens": 800,
            "completion_tokens": 5,
            "total_tokens": 805,
            "input_tokens_details": {"cached_tokens": 640},
        }
    )
    assert out is not None
    assert out["cached_tokens"] == 640


def test_normalize_stream_usage_empty_returns_none() -> None:
    assert normalize_stream_usage(None) is None
    assert normalize_stream_usage({}) is None
    assert normalize_stream_usage(SimpleNamespace(prompt_tokens=0, completion_tokens=0)) is None
    # MagicMock is truthy and implements __int__ -> 1; must not invent usage.
    assert normalize_stream_usage(MagicMock()) is None


def test_stream_response_usage_reaches_ledger_metadata() -> None:
    """agent_runtime builds StreamResponse(usage=stream_usage) then persists this."""
    stream_usage = normalize_stream_usage(
        {
            "prompt_tokens": 23578,
            "completion_tokens": 180,
            "total_tokens": 23758,
            "prompt_tokens_details": {"cached_tokens": 22100},
        }
    )
    response = SimpleNamespace(
        content="ok",
        tool_calls=[],
        usage=stream_usage,
        finish_reason="stop",
    )
    meta = usage_metadata_from_llm_response(response)
    assert meta is not None
    assert meta["input_tokens"] == 23578
    assert meta["cached_tokens"] == 22100


def _usage_events(chunks) -> list[dict]:
    return [
        item["usage"]
        for item in chunks
        if isinstance(item, dict) and item.get("type") == "usage"
    ]


def test_litellm_stream_with_tools_forwards_cached_tokens(monkeypatch) -> None:
    usage = SimpleNamespace(
        prompt_tokens=23445,
        completion_tokens=190,
        total_tokens=23635,
        prompt_tokens_details=SimpleNamespace(cached_tokens=22000),
        completion_tokens_details=None,
    )
    chunks = [
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    delta=SimpleNamespace(
                        reasoning_content=None,
                        reasoning=None,
                        reasoning_details=None,
                        content="hi",
                        tool_calls=None,
                    ),
                )
            ],
            usage=usage,
        )
    ]

    def _fake_completion(**kwargs):
        return iter(chunks)

    monkeypatch.setattr(litellm_provider_module.litellm, "completion", _fake_completion)
    provider = LiteLLMProvider(model="openai/MiniMax-M2.7", api_key="k", base_url="https://example/v1")
    events = _usage_events(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))
    assert events
    assert events[-1]["cached_tokens"] == 22000
    assert events[-1]["prompt_tokens"] == 23445


def test_kimi_stream_with_tools_forwards_cached_tokens() -> None:
    usage = SimpleNamespace(
        prompt_tokens=1000,
        completion_tokens=10,
        total_tokens=1010,
        cached_tokens=768,
        prompt_tokens_details=None,
        completion_tokens_details=None,
    )
    chunk = SimpleNamespace(
        choices=[
            SimpleNamespace(
                finish_reason="stop",
                delta=SimpleNamespace(reasoning_content=None, content="ok", tool_calls=None),
            )
        ],
        usage=usage,
    )
    captured: dict = {}

    def _create(**kwargs):
        captured.update(kwargs)
        return [chunk]

    provider = KimiProvider(model="kimi-k2.6", api_key="k")
    provider.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create)))
    events = _usage_events(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))
    assert captured.get("stream_options", {}).get("include_usage") is True
    assert events[-1]["cached_tokens"] == 768


def test_bailian_stream_with_tools_forwards_cached_tokens() -> None:
    usage = SimpleNamespace(
        prompt_tokens=800,
        completion_tokens=5,
        total_tokens=805,
        prompt_tokens_details=SimpleNamespace(cached_tokens=640),
        completion_tokens_details=None,
    )
    delta = MagicMock()
    delta.content = "hello"
    delta.tool_calls = None
    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = "stop"
    chunk = MagicMock()
    chunk.choices = [choice]
    chunk.usage = usage

    provider = BailianProvider(model="qwen-max", api_key="test-key")
    provider.client = MagicMock()
    provider.client.chat.completions.create.return_value = [chunk]
    events = _usage_events(
        provider.stream_with_tools([{"role": "user", "content": "test"}], tools=None)
    )
    assert events[-1]["cached_tokens"] == 640


def test_ark_stream_with_tools_forwards_cached_tokens() -> None:
    usage = SimpleNamespace(
        prompt_tokens=500,
        completion_tokens=8,
        total_tokens=508,
        prompt_tokens_details=SimpleNamespace(cached_tokens=400),
        completion_tokens_details=None,
    )
    delta = MagicMock()
    delta.content = "hello"
    delta.tool_calls = None
    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = "stop"
    chunk = MagicMock()
    chunk.choices = [choice]
    chunk.usage = usage

    provider = ArkLLMProvider(api_key="test-key")
    provider.client = MagicMock()
    provider.client.chat.completions.create.return_value = [chunk]
    events = _usage_events(
        provider.stream_with_tools([{"role": "user", "content": "test"}], tools=None)
    )
    assert events[-1]["cached_tokens"] == 400
