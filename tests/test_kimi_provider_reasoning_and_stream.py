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


def test_fill_reasoning_content_for_tool_calls_inserts_placeholder():
    provider = KimiProvider(model="kimi-k2.6", api_key="k")
    history = [
        {"role": "user", "content": "run"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "bash_exec", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": "ok"},
    ]
    patched = provider._fill_reasoning_content_for_tool_call_messages(history)
    assistant = patched[1]
    assert assistant.get("reasoning_content") == " "


def test_fill_reasoning_content_extracts_from_redacted_thinking_tags():
    provider = KimiProvider(model="kimi-k2.6", api_key="k")
    text = (
        "<think>plan ahead</think>\n"
        "Calling tool now."
    )
    history = [
        {"role": "assistant", "content": text, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "x", "arguments": "{}"}}]},
    ]
    patched = provider._fill_reasoning_content_for_tool_call_messages(history)
    assert patched[0].get("reasoning_content") == "plan ahead"
    assert patched[0].get("content") == "Calling tool now."


def test_prepare_request_skips_patch_when_thinking_disabled():
    provider = KimiProvider(model="kimi-k2.6", api_key="k")
    history = [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "x", "arguments": "{}"}}],
        },
    ]
    kwargs = {"thinking": {"type": "disabled"}}
    out = provider._prepare_request_messages(history, kwargs)
    assert out is history
    assert "reasoning_content" not in out[0]
