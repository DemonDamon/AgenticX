#!/usr/bin/env python3
"""Regression tests for last-turn completion detection.

Author: Damon Li
"""

from agenticx.studio.session_manager import _messages_last_turn_has_completed_reply


def test_reply_then_unresolved_tool_calls_is_not_completed() -> None:
    """A preamble reply followed by further tool_calls is not completed."""
    messages = [
        {"role": "user", "content": "你直接帮我做的了吧"},
        {"role": "assistant", "content": "我建议直接做 B 的增强版"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "skill_use"}}],
        },
        {"role": "tool", "content": "OK: activated skill"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "bash_exec"}}],
        },
        {"role": "tool", "content": "exit_code=0 stdout: ..."},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is False


def test_reply_after_tool_rows_is_completed() -> None:
    """A complete wrap-up reply remains completed with trailing tool rows."""
    messages = [
        {"role": "user", "content": "继续未完成的任务"},
        {"role": "assistant", "content": "<think>...</think>任务已恢复并完成"},
        {"role": "tool", "content": "[x][x][x][x] (4/4 completed)"},
        {"role": "assistant", "content": "任务已恢复并完成。Skill 已落盘并验证通过。"},
        {"role": "tool", "content": "已完成（4/4）"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_plain_reply_with_trailing_tool_log_is_completed() -> None:
    """A plain answer with trailing tool log should still be completed."""
    messages = [
        {"role": "user", "content": "查知识库"},
        {"role": "assistant", "content": "费马大定理的核心是：..."},
        {"role": "tool", "content": "hits"},
    ]
    assert _messages_last_turn_has_completed_reply(messages) is True


def test_no_assistant_reply_is_not_completed() -> None:
    """No assistant response means not completed."""
    messages = [{"role": "user", "content": "问题"}]
    assert _messages_last_turn_has_completed_reply(messages) is False
