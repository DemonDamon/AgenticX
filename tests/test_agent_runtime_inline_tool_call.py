#!/usr/bin/env python3
"""Tests for inline tool call extraction fallback.

Author: Damon Li
"""

from agenticx.runtime.agent_runtime import (
    _extract_inline_tool_call,
    _sanitize_structured_assistant_text,
)


def test_extract_inline_tool_call_from_openai_style_tool_calls_json() -> None:
    text = (
        '{"tool_calls":[{"function":"respond","args":{"content":"您好！有什么可以帮您的吗？"}}]}'
    )
    # Accept both OpenAI-style function object and simplified function+args.
    text = text.replace(
        '"function":"respond","args"',
        '"function":{"name":"respond","arguments":{"content":"您好！有什么可以帮您的吗？"}},"args"',
    )
    parsed = _extract_inline_tool_call(text, {"respond"})
    assert parsed is not None
    assert parsed["name"] == "respond"
    assert parsed["arguments"]["content"] == "您好！有什么可以帮您的吗？"


def test_extract_inline_tool_call_from_tool_calls_json_string_arguments() -> None:
    text = (
        '{"tool_calls":[{"function":{"name":"respond","arguments":"{\\"content\\":\\"ok\\"}"}}]}'
    )
    parsed = _extract_inline_tool_call(text, {"respond"})
    assert parsed == {"name": "respond", "arguments": {"content": "ok"}}


def test_sanitize_structured_assistant_text_extracts_respond_content() -> None:
    text = (
        '{"tool_calls":[{"function":{"name":"respond","arguments":{"content":"您好！有什么可以帮您的吗？"}}}]}'
    )
    cleaned = _sanitize_structured_assistant_text(text, {"respond"})
    assert cleaned == "您好！有什么可以帮您的吗？"


def test_sanitize_structured_assistant_text_drops_thought_only_json() -> None:
    text = '{"thought":"internal planning","tool_calls":[]}'
    cleaned = _sanitize_structured_assistant_text(text, {"respond"})
    assert cleaned == ""
