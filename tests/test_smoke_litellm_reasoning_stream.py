#!/usr/bin/env python3
"""Smoke test: base LiteLLMProvider.stream_with_tools forwards reasoning_content.

Regression guard for the MiniMax M2.x/M3 "已停滞" stall bug: reasoning models
stream `reasoning_content` before `content` (especially in the round right after
a tool call). The base provider previously dropped those deltas, so the backend
emitted zero tokens during the entire thinking phase and the UI falsely showed
"已停滞" / triggered an idle timeout. The provider must now wrap reasoning in
<think>...</think> and forward it so the silent timer keeps refreshing.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

import agenticx.llms.litellm_provider as litellm_provider_module
from agenticx.llms.litellm_provider import LiteLLMProvider


def _chunk(*, reasoning=None, reasoning_details=None, content=None, finish_reason=None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                finish_reason=finish_reason,
                delta=SimpleNamespace(
                    reasoning_content=reasoning,
                    reasoning_details=reasoning_details,
                    content=content,
                    tool_calls=None,
                ),
            )
        ],
        usage=None,
    )


def _collect_content(stream_chunks):
    return "".join(
        item.get("text", "")
        for item in stream_chunks
        if isinstance(item, dict) and item.get("type") == "content"
    )


def test_stream_with_tools_forwards_reasoning_as_think_tags(monkeypatch):
    chunks = [
        _chunk(reasoning="thinking about "),
        _chunk(reasoning="AI gateway"),
        _chunk(content="final answer", finish_reason="stop"),
    ]

    def _fake_completion(**kwargs):
        return iter(chunks)

    monkeypatch.setattr(litellm_provider_module.litellm, "completion", _fake_completion)

    provider = LiteLLMProvider(model="openai/MiniMax-M3", api_key="k", base_url="https://example/v1")
    text = _collect_content(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))

    assert text == "<think>thinking about AI gateway</think>\nfinal answer"


def test_stream_with_tools_forwards_reasoning_details(monkeypatch):
    chunks = [
        _chunk(reasoning_details=[{"text": "plan "}]),
        _chunk(reasoning_details=[{"text": "search"}]),
        _chunk(content="answer", finish_reason="stop"),
    ]

    def _fake_completion(**kwargs):
        return iter(chunks)

    monkeypatch.setattr(litellm_provider_module.litellm, "completion", _fake_completion)

    provider = LiteLLMProvider(model="openai/MiniMax-M2.7", api_key="k", base_url="https://example/v1")
    text = _collect_content(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))

    assert text == "<think>plan search</think>\nanswer"


def test_stream_with_tools_closes_think_when_only_reasoning(monkeypatch):
    # Round that ends with reasoning only (e.g. before a tool call) must still
    # close the think tag so downstream parsing isn't left open.
    chunks = [
        _chunk(reasoning="deciding to call tool"),
        _chunk(finish_reason="tool_calls"),
    ]

    def _fake_completion(**kwargs):
        return iter(chunks)

    monkeypatch.setattr(litellm_provider_module.litellm, "completion", _fake_completion)

    provider = LiteLLMProvider(model="openai/MiniMax-M3", api_key="k", base_url="https://example/v1")
    text = _collect_content(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))

    assert text == "<think>deciding to call tool</think>"
