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
