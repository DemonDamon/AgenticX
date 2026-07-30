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


def test_extract_glm_xml_tool_call_file_edit_canonical() -> None:
    text = (
        "继续编辑。"
        "<tool_call>file_edit"
        "<arg_key>path</arg_key><arg_value>/tmp/a.html</arg_value>"
        "<arg_key>old_text</arg_key><arg_value>OLD</arg_value>"
        "<arg_key>new_text</arg_key><arg_value>NEW</arg_value>"
        "</tool_call>"
    )
    parsed = _extract_inline_tool_call(text, {"file_edit", "file_write"})
    assert parsed == {
        "name": "file_edit",
        "arguments": {
            "path": "/tmp/a.html",
            "old_text": "OLD",
            "new_text": "NEW",
        },
    }


def test_extract_glm_xml_tool_call_sticky_new_str_alias() -> None:
    text = (
        "骨架已写入。现在追加第一部分。"
        "<tool_call>file_edit"
        '<arg_key>new_str:          <div class="section">hi</div></arg_value>'
        '<arg_key>old_str:          <div id="content"></div></arg_value>'
        "<arg_key>path</arg_key>"
        "<arg_value>/tmp/openhuman-architecture.html</arg_value>"
        "</tool_call>"
    )
    parsed = _extract_inline_tool_call(text, {"file_edit"})
    assert parsed is not None
    assert parsed["name"] == "file_edit"
    assert parsed["arguments"]["path"] == "/tmp/openhuman-architecture.html"
    assert parsed["arguments"]["old_text"] == '          <div id="content"></div>'
    assert parsed["arguments"]["new_text"] == '          <div class="section">hi</div>'


def test_extract_glm_xml_ignores_unknown_tool_name() -> None:
    text = (
        "<tool_call>unknown_tool"
        "<arg_key>path</arg_key><arg_value>/tmp/a</arg_value>"
        "</tool_call>"
    )
    parsed = _extract_inline_tool_call(text, {"file_edit"})
    assert parsed is None
