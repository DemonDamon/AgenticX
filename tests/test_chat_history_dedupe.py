#!/usr/bin/env python3
"""Tests for chat_history tail dedupe helpers."""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _chat_history_append_deduped


def test_chat_history_append_deduped_skips_identical_tail() -> None:
    history = [{"role": "user", "content": "你好"}]
    assert _chat_history_append_deduped(history, {"role": "user", "content": "你好"}) is False
    assert len(history) == 1


def test_chat_history_append_deduped_appends_different_content() -> None:
    history = [{"role": "user", "content": "你好"}]
    assert _chat_history_append_deduped(history, {"role": "assistant", "content": "你好！"}) is True
    assert len(history) == 2


def test_chat_history_append_deduped_skips_duplicate_assistant() -> None:
    history = [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "你好！有什么我可以帮你的吗？"},
    ]
    assert (
        _chat_history_append_deduped(
            history,
            {"role": "assistant", "content": "你好！有什么我可以帮你的吗？"},
        )
        is False
    )
    assert len(history) == 2


def test_chat_history_append_deduped_absorbs_duplicate_across_tool() -> None:
    """Same final after a dummy tool must not become a second bubble.

    Session ae7b5446: complete answer, empty todo_write, then the same
    answer again with trailing newlines and turn_terminal=true.
    """
    body = "看完了，团长。结论先说：这是兼容，不是合并。"
    history = [
        {"role": "user", "content": "他们怎么统一的"},
        {
            "role": "assistant",
            "content": body,
            "metadata": {"turn_terminal": False},
        },
        {
            "role": "tool",
            "content": "No todos.",
            "tool_name": "todo_write",
        },
    ]
    appended = _chat_history_append_deduped(
        history,
        {
            "role": "assistant",
            "content": body + "\n\n",
            "metadata": {"turn_terminal": True, "terminal_reason": "model_final"},
            "suggested_questions": ["A", "B", "C"],
            "provider": "custom",
            "model": "glm-5.3-flash",
        },
    )
    assert appended is False
    assistants = [row for row in history if row.get("role") == "assistant"]
    assert len(assistants) == 1
    assert assistants[0]["metadata"]["turn_terminal"] is True
    assert assistants[0]["metadata"]["terminal_reason"] == "model_final"
    assert assistants[0]["suggested_questions"] == ["A", "B", "C"]
    assert assistants[0]["model"] == "glm-5.3-flash"


def test_chat_history_append_deduped_keeps_different_assistant_after_tool() -> None:
    history = [
        {"role": "user", "content": "继续"},
        {"role": "assistant", "content": "我先打开页面。", "metadata": {"turn_terminal": False}},
        {"role": "tool", "content": "ok", "tool_name": "near_browser_open"},
    ]
    appended = _chat_history_append_deduped(
        history,
        {"role": "assistant", "content": "看完了，这是最终结论。"},
    )
    assert appended is True
    assert [row.get("content") for row in history if row.get("role") == "assistant"] == [
        "我先打开页面。",
        "看完了，这是最终结论。",
    ]


def test_chat_history_append_deduped_absorbs_think_wrapped_duplicate() -> None:
    body = "看完了，团长。结论先说：这是兼容，不是合并。"
    think_open = chr(60) + "think" + chr(62)
    think_close = chr(60) + "/think" + chr(62)
    history = [
        {"role": "user", "content": "他们怎么统一的"},
        {
            "role": "assistant",
            "content": f"{think_open}skip todo_write (simple Q&A){think_close}{body}",
            "metadata": {"turn_terminal": False},
        },
        {"role": "tool", "content": "No todos.", "tool_name": "todo_write"},
    ]
    appended = _chat_history_append_deduped(
        history,
        {"role": "assistant", "content": body + "\n\n", "metadata": {"turn_terminal": True}},
    )
    assert appended is False
    assistants = [row for row in history if row.get("role") == "assistant"]
    assert len(assistants) == 1
    assert assistants[0]["metadata"]["turn_terminal"] is True
