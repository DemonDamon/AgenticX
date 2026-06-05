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


def test_messages_last_turn_completed_true_for_suggested_questions_only() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {
            "role": "assistant",
            "content": "",
            "suggested_questions": ["继续说明？"],
        },
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_messages_last_turn_completed_true_for_followups_marker() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "<followups></followups>"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_messages_last_turn_completed_false_for_interrupted_placeholder() -> None:
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "（已中断）"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


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
