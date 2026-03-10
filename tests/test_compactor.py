#!/usr/bin/env python3
"""Tests for context compactor."""

from __future__ import annotations

import asyncio

from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("关键决策: A；工具结果: B；文件改动: C；风险: D")


def test_compactor_compacts_when_message_count_exceeded() -> None:
    compactor = ContextCompactor(_LLM(), threshold_messages=5, retain_recent_messages=2)
    messages = [{"role": "user", "content": f"msg-{i}"} for i in range(9)]
    compacted, changed, summary, count = asyncio.run(compactor.maybe_compact(messages))
    assert changed is True
    assert count == 5
    assert summary
    assert compacted[0]["role"] == "system"
    assert "[compacted]" in compacted[0]["content"]
    assert len(compacted) == 5


def test_compactor_skips_when_below_threshold() -> None:
    compactor = ContextCompactor(_LLM(), threshold_messages=10, retain_recent_messages=4)
    messages = [{"role": "assistant", "content": "ok"} for _ in range(3)]
    compacted, changed, summary, count = asyncio.run(compactor.maybe_compact(messages))
    assert changed is False
    assert summary == ""
    assert count == 0
    assert compacted == messages
