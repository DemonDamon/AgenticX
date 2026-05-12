#!/usr/bin/env python3
"""Tests for Kimi reasoning content and streaming behavior.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.llms.kimi_provider import KimiProvider


def _make_stream_client(chunks):
    def _create(**kwargs):
        return chunks

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create)))


def test_parse_response_wraps_reasoning_content_in_think_tags():
    provider = KimiProvider(model="kimi-k2.6", api_key="k",)
    response = SimpleNamespace(
        id="resp-1",
        model="kimi-k2.6",
        created=0,
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        choices=[
            SimpleNamespace(
                index=0,
                finish_reason="stop",
                message=SimpleNamespace(content="final answer", reasoning_content="chain of thought"),
            )
        ],
    )

    parsed = provider._parse_response(response)

    assert parsed.content.startswith("<think>chain of thought</think>")
    assert "final answer" in parsed.content


def test_stream_with_tools_emits_think_tags_from_reasoning_deltas():
    provider = KimiProvider(model="kimi-k2.6", api_key="k",)
    chunks = [
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason=None,
                    delta=SimpleNamespace(reasoning_content="step1 ", content=None, tool_calls=None),
                )
            ],
            usage=None,
        ),
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason=None,
                    delta=SimpleNamespace(reasoning_content="step2", content=None, tool_calls=None),
                )
            ],
            usage=None,
        ),
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    delta=SimpleNamespace(reasoning_content=None, content="final", tool_calls=None),
                )
            ],
            usage=None,
        ),
    ]
    provider.client = _make_stream_client(chunks)

    stream_chunks = list(provider.stream_with_tools([{"role": "user", "content": "hi"}], tools=[]))
    text = "".join(
        item.get("text", "")
        for item in stream_chunks
        if isinstance(item, dict) and item.get("type") == "content"
    )

    assert text.startswith("<think>step1 step2</think>")
    assert text.endswith("final")
