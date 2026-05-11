#!/usr/bin/env python3
"""Smoke tests: context compactor enhancements (module 2).

Author: Damon Li
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("摘要: 完成")


def test_micro_compact_truncates() -> None:
    c = ContextCompactor(_LLM())
    long = "x" * 5000
    out = c.micro_compact_tool_result("file_read", long, budget=400)
    assert len(out) < len(long)
    assert "truncated" in out


@pytest.mark.asyncio
async def test_maybe_compact_force_skips_threshold() -> None:
    c = ContextCompactor(_LLM(), threshold_messages=100, retain_recent_messages=4)
    messages = [{"role": "user", "content": f"m{i}"} for i in range(10)]
    compacted, changed, _summary, _count, _pending = await c.maybe_compact(messages, force=True, model="")
    assert changed is True
    assert compacted[0]["role"] == "system"


@pytest.mark.asyncio
async def test_session_memory_injected() -> None:
    c = ContextCompactor(_LLM(), threshold_messages=8, retain_recent_messages=4)
    tail = [{"role": "user", "content": f"u{i}"} for i in range(4)]
    messages = [
        {
            "role": "assistant",
            "content": "我们决定采用方案 B",
            "tool_calls": [
                {
                    "id": "t1",
                    "type": "function",
                    "function": {"name": "file_write", "arguments": '{"path":"/tmp/a.txt"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "t1", "name": "file_write", "content": "OK: wrote /tmp/a.txt"},
        *tail,
    ]
    compacted, changed, summary, _count, _pending = await c.maybe_compact(messages, model="", force=True)
    assert changed is True
    assert "[session_memory]" in compacted[0]["content"]
    assert summary
