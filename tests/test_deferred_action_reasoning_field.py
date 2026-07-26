"""Regression coverage for deferred-action reasoning persisted separately."""

from __future__ import annotations

from agenticx.studio.session_manager import (
    _messages_last_turn_promised_action_without_followthrough,
)


def test_detects_english_action_intent_from_dedicated_reasoning_field() -> None:
    messages = [
        {"role": "user", "content": "核实这条信息"},
        {
            "role": "assistant",
            "content": "团长，这条信息涉及具体发布日期、定价和竞品对比",
            "reasoning": "I need to search the web to verify this. Let me do that.",
            "metadata": {
                "turn_terminal": True,
                "terminal_reason": "suspected_truncated_final",
            },
        },
    ]

    assert _messages_last_turn_promised_action_without_followthrough(messages) is True


def test_ignores_complete_long_answer_without_action_intent() -> None:
    messages = [
        {"role": "user", "content": "说明结果"},
        {
            "role": "assistant",
            "content": "这是已经完整结束的正常回答。" * 10,
            "reasoning": "",
            "metadata": {"turn_terminal": True, "terminal_reason": "model_final"},
        },
    ]

    assert _messages_last_turn_promised_action_without_followthrough(messages) is False
