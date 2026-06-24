#!/usr/bin/env python3
"""Smoke tests: rolling compaction does not re-trigger on compact block size alone.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("rolling summary preserved")


def _compact_block_with_huge_body() -> Dict[str, Any]:
    return {
        "role": "system",
        "content": (
            "[session_memory]{\"files_modified\":[]}\n\n"
            "[compacted] 已压缩 14 条历史消息，以下为摘要：\n"
            + ("x" * 60_000)
        ),
    }


def test_compacted_prefix_does_not_retrigger_on_block_chars() -> None:
    """Large prior compact block must not cause compaction every turn."""
    compactor = ContextCompactor(_LLM(), threshold_messages=20, threshold_chars=48_000)
    tail = [{"role": "user", "content": f"short-{i}"} for i in range(9)]
    messages: List[Dict[str, Any]] = [_compact_block_with_huge_body(), *tail]

    compacted, did_compact, _summary, count, _pending = asyncio.run(
        compactor.maybe_compact(messages, model="gpt-4o")
    )
    assert did_compact is False
    assert count == 0
    assert compacted == messages


def test_rolling_compact_only_counts_tail_messages() -> None:
    compactor = ContextCompactor(_LLM(), threshold_messages=20, retain_recent_messages=8)
    tail = [{"role": "user", "content": f"msg-{i}"} for i in range(21)]
    messages: List[Dict[str, Any]] = [
        {
            "role": "system",
            "content": "[compacted] 已压缩 10 条历史消息，以下为摘要：\nold summary",
        },
        *tail,
    ]

    compacted, did_compact, _summary, count, _pending = asyncio.run(
        compactor.maybe_compact(messages, model="")
    )
    assert did_compact is True
    assert count == 13  # 21 tail - 8 retained
    assert len(compacted) == 9
    assert "[compacted]" in compacted[0]["content"]
