#!/usr/bin/env python3
"""Tests for inline tool call extraction fallback.

Author: Damon Li
"""

from agenticx.runtime.agent_runtime import (
    _extract_inline_tool_call,
    _has_unexecuted_inline_tool_markup,
    _sanitize_structured_assistant_text,
    _strip_inline_tool_markup,
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


def test_extract_invoke_web_search_session_payload() -> None:
    text = (
        "\n团长，我先查一下再回答，避免凭印象误导。\n\n"
        '<invoke name="web_search">\n'
        "<parameter name=\"query\">ExampleAgent 是什么 哪个厂商 开源项目</parameter>\n"
        "</invoke>"
    )
    parsed = _extract_inline_tool_call(text, {"web_search"})
    assert parsed == {
        "name": "web_search",
        "arguments": {"query": "ExampleAgent 是什么 哪个厂商 开源项目"},
    }


def test_extract_invoke_wrapped_in_tool_call_tag() -> None:
    inner = (
        '<invoke name="web_search">'
        "<parameter name=\"query\">latest release notes</parameter>"
        "</invoke>"
    )
    wrapped = f"<tool_call>{inner}</tool_call>"
    namespaced = f"<x:tool_call>{inner}</x:tool_call>"
    allowed = {"web_search"}
    assert _extract_inline_tool_call(wrapped, allowed) == {
        "name": "web_search",
        "arguments": {"query": "latest release notes"},
    }
    assert _extract_inline_tool_call(namespaced, allowed) == {
        "name": "web_search",
        "arguments": {"query": "latest release notes"},
    }


def test_extract_invoke_ignores_unknown_tool_name() -> None:
    text = (
        '<invoke name="not_a_real_tool">'
        "<parameter name=\"query\">anything</parameter>"
        "</invoke>"
    )
    parsed = _extract_inline_tool_call(text, {"web_search"})
    assert parsed is None


def test_strip_inline_tool_markup_keeps_preamble() -> None:
    text = (
        "团长，我先查一下再回答，避免凭印象误导。\n\n"
        '<invoke name="web_search">\n'
        "<parameter name=\"query\">ExampleAgent 是什么 哪个厂商 开源项目</parameter>\n"
        "</invoke>"
    )
    cleaned = _strip_inline_tool_markup(text)
    assert cleaned == "团长，我先查一下再回答，避免凭印象误导。"
    assert "<invoke" not in cleaned
    assert "<parameter" not in cleaned


def test_has_unexecuted_inline_tool_markup_true_for_invoke() -> None:
    text = (
        "我先查一下。\n"
        '<invoke name="web_search">'
        "<parameter name=\"query\">q</parameter>"
        "</invoke>"
    )
    assert _has_unexecuted_inline_tool_markup(text) is True


def test_has_unexecuted_inline_tool_markup_false_for_plain_prose() -> None:
    assert _has_unexecuted_inline_tool_markup("团长，这是普通回复。") is False


def test_extract_inline_tool_call_ignores_skip_todo_write_prose() -> None:
    """Reasoning that mentions skip todo_write (...) is not a real tool call.

    Session ae7b5446: GLM wrote a complete answer plus
    ``skip todo_write (it's a simple answer task...)``. The parenthetical
    fallback treated that as ``todo_write({})``, persisted the answer as a
    mid-turn bubble, then regenerated the same final — the retry 拼接.
    """
    think_open = chr(60) + "think" + chr(62)
    think_close = chr(60) + "/think" + chr(62)
    text = (
        f"{think_open}I have enough content. No todo needed really—"
        "this is a Q&A; skip todo_write (it's a simple answer task, "
        "per rules don't use todo for single-round Q&A)."
        f"{think_close}"
        "看完了，团长。结论先说：**所谓「统一」其实是兼容，不是合并**。"
    )
    parsed = _extract_inline_tool_call(
        text, {"todo_write", "web_fetch", "near_browser_extract_text"}
    )
    assert parsed is None


def test_extract_inline_tool_call_ignores_todo_write_english_parens() -> None:
    text = (
        "No todo needed; skip todo_write (it's a simple answer task).\n\n"
        "看完了，团长。这是最终回复。"
    )
    parsed = _extract_inline_tool_call(text, {"todo_write", "web_search"})
    assert parsed is None


def test_extract_inline_tool_call_keeps_real_todo_write_json() -> None:
    text = 'todo_write({"todos": [{"id": "1", "content": "读文章", "status": "in_progress"}]})'
    parsed = _extract_inline_tool_call(text, {"todo_write"})
    assert parsed == {
        "name": "todo_write",
        "arguments": {
            "todos": [{"id": "1", "content": "读文章", "status": "in_progress"}]
        },
    }


def test_extract_inline_tool_call_keeps_empty_check_resources() -> None:
    parsed = _extract_inline_tool_call("print(check_resources())", {"check_resources"})
    assert parsed == {"name": "check_resources", "arguments": {}}
