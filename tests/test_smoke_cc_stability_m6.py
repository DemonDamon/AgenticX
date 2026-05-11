#!/usr/bin/env python3
"""Smoke tests: token-budget reactive compaction hook (module 6).

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
        return _Resp("压缩摘要")


@pytest.mark.asyncio
async def test_maybe_compact_force_true() -> None:
    c = ContextCompactor(_LLM(), threshold_messages=999, retain_recent_messages=4)
    messages = [{"role": "user", "content": f"x{i}"} for i in range(12)]
    new_msgs, did, summary, count, _pending = await c.maybe_compact(messages, force=True, model="gpt-4o")
    assert did is True
    assert count == len(messages) - c.retain_recent_messages
    assert summary
    assert new_msgs[0]["role"] == "system"
