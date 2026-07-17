#!/usr/bin/env python3
"""Tests for interrupted-turn completeness alignment (visible body + partial finalize).

Plan-Id: 2026-06-05-interrupted-turn-finalize-and-completeness-truth

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.studio.server import (
    _accumulate_meta_partial_text,
    _finalize_partial_assistant_if_needed,
)
from agenticx.studio.session_manager import (
    _messages_last_turn_has_completed_reply,
    _messages_last_turn_promised_action_without_followthrough,
    _visible_assistant_body,
)


def test_visible_assistant_body_closed_think_with_body() -> None:
    assert (
        _visible_assistant_body("<think>x</think>正文")
        == "正文"
    )


def test_visible_assistant_body_unclosed_think_only() -> None:
    assert _visible_assistant_body("<think>用户让我记住他") == ""


def test_visible_assistant_body_closed_think_then_body_with_punctuation() -> None:
    assert (
        _visible_assistant_body(
            "<think>a</think>上一次任务的未完成项："
        )
        == "上一次任务的未完成项："
    )


def test_visible_assistant_body_plain_text() -> None:
    assert _visible_assistant_body("  纯正文  ") == "纯正文"


def test_messages_last_turn_completed_false_for_unclosed_think() -> None:
    messages = [
        {"role": "user", "content": "记住我"},
        {"role": "assistant", "content": "<think>用户让我记住他"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_true_for_visible_body() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": "<think>思考</think>这是回答",
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_messages_last_turn_completed_false_for_suggested_questions_only() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": "",
            "suggested_questions": ["继续说明？", "再问一次？", "补充细节？"],
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_false_for_followups_marker_only() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "<followups></followups>"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_true_for_body_and_valid_sq() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": "这是回答",
            "suggested_questions": ["问题1", "问题2", "问题3"],
            "metadata": {"turn_terminal": True, "terminal_reason": "model_final"},
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_messages_last_turn_completed_false_for_malformed_polluted_sq() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": (
                "<think>r<followups>prompt</think>\n"
                "**标题**\n|a|b|\n</followups>"
            ),
            "suggested_questions": [
                "Plus the mandatory",
                "**分身「侠客」已创建完成。**",
                "| 项目 | 内容 |",
            ],
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_false_for_tool_preface_marker() -> None:
    messages = [
        {"role": "user", "content": "建分身"},
        {
            "role": "assistant",
            "content": "开始创建",
            "metadata": {"turn_terminal": False},
        },
        {"role": "tool", "content": "ok", "tool_name": "create_avatar"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_true_after_tool_preface_then_final() -> None:
    messages = [
        {"role": "user", "content": "建分身"},
        {
            "role": "assistant",
            "content": "开始创建",
            "metadata": {"turn_terminal": False},
        },
        {"role": "tool", "content": "ok", "tool_name": "create_avatar"},
        {
            "role": "assistant",
            "content": "数字分身已创建",
            "metadata": {"turn_terminal": True, "terminal_reason": "tool_result_fallback"},
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_messages_last_turn_completed_false_for_interrupted_partial_source() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": "半截正文",
            "metadata": {"source": "interrupted-partial"},
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_completed_false_for_interrupted_placeholder() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "（已中断）"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_messages_last_turn_promised_action_without_followthrough() -> None:
    messages = [
        {"role": "user", "content": "分析 mp4"},
        {
            "role": "assistant",
            "content": (
                "<think>让我先读取 composition 源码，然后加载相关 skill。"
                "</think>\n"
                "我先读取 composition 源码，同时加载 HyperFrames skill 来给你完整方案。"
            ),
        },
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is True


def test_messages_last_turn_promised_action_false_when_tools_follow() -> None:
    messages = [
        {"role": "user", "content": "分析 mp4"},
        {
            "role": "assistant",
            "content": "<think>让我先读取文件。</think>\n我先读取源码。",
        },
        {"role": "tool", "content": "exit_code=0\nstdout:\nok", "tool_name": "file_read"},
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is False


def test_handoff_body_without_reasoning() -> None:
    """Path B: explicit handoff in body, no reasoning block, no tool_calls."""
    messages = [
        {"role": "user", "content": "继续优化视频"},
        {
            "role": "assistant",
            "content": (
                "验收已完成：视频能用，但偏\"模板化介绍页\"。"
                "我现在进入第二项：直接优化 composition，做一个更像成片的版本"
            ),
        },
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is True


def test_handoff_short_body_variants() -> None:
    """Path B variants — different handoff phrases."""
    samples = [
        "我现在去读取 composition 文件",
        "让我开始优化",
        "接下来我去执行 bash_exec",
        "我来试试新的方案",
    ]
    for body in samples:
        messages = [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": body},
        ]
        assert _messages_last_turn_promised_action_without_followthrough(messages) is True, body


def test_handoff_negative_long_narrative() -> None:
    """Path B negative: long body — normal prose, not a deferred stub."""
    body = "我们分两点说明。第一点是 …" + "（具体分析展开）" * 30  # > 300 chars
    messages = [
        {"role": "user", "content": "解释一下"},
        {"role": "assistant", "content": body},
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is False


def test_handoff_negative_with_tool_row_in_turn() -> None:
    """Path B negative: a tool row already exists in this turn -> not deferred."""
    messages = [
        {"role": "user", "content": "go"},
        {"role": "tool", "content": "OK", "tool_name": "bash_exec"},
        {"role": "assistant", "content": "我现在进入第二项：直接优化 composition"},
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is False


def test_handoff_negative_with_tool_calls() -> None:
    """Path B negative: assistant has tool_calls populated -> not deferred."""
    messages = [
        {"role": "user", "content": "go"},
        {
            "role": "assistant",
            "content": "我现在进入第二项",
            "tool_calls": [{"id": "x", "function": {"name": "bash_exec"}}],
        },
    ]
    assert _messages_last_turn_promised_action_without_followthrough(messages) is False


def test_accumulate_meta_partial_text_skips_spinner() -> None:
    evt = RuntimeEvent(type=EventType.TOKEN.value, data={"text": "⏳"}, agent_id="meta")
    assert _accumulate_meta_partial_text("hello", evt) == "hello"


def test_accumulate_meta_partial_text_appends_meta_tokens() -> None:
    evt = RuntimeEvent(type=EventType.TOKEN.value, data={"text": " world"}, agent_id="meta")
    assert _accumulate_meta_partial_text("hello", evt) == "hello world"


def test_finalize_partial_assistant_appends_when_not_final() -> None:
    session = SimpleNamespace(chat_history=[])
    partial = "<think>思考</think>partial answer"
    assert (
        _finalize_partial_assistant_if_needed(
            session, partial, saw_final=False
        )
        is True
    )
    assert len(session.chat_history) == 1
    row = session.chat_history[0]
    assert row["role"] == "assistant"
    assert row["content"] == partial
    assert row["metadata"]["source"] == "interrupted-partial"


def test_finalize_partial_assistant_skips_when_saw_final() -> None:
    session = SimpleNamespace(chat_history=[])
    partial = "<think>思考</think>partial answer"
    assert (
        _finalize_partial_assistant_if_needed(
            session, partial, saw_final=True
        )
        is False
    )
    assert session.chat_history == []


def test_finalize_partial_assistant_skips_pure_think() -> None:
    session = SimpleNamespace(chat_history=[])
    partial = "<think>只有思考"
    assert (
        _finalize_partial_assistant_if_needed(
            session, partial, saw_final=False
        )
        is False
    )
    assert session.chat_history == []
