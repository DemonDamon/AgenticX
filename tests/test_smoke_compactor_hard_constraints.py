#!/usr/bin/env python3
"""Smoke tests for compactor hard-constraint fidelity.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLMWithRetry:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _Resp("摘要：只写了进度，没有硬约束")
        return _Resp("摘要：必须不要删除配置，始终保留审批步骤。")


def test_compactor_retries_when_constraints_missing() -> None:
    llm = _LLMWithRetry()
    compactor = ContextCompactor(llm, threshold_messages=8, retain_recent_messages=4)
    messages = [
        {"role": "user", "content": "请你必须不要删除配置，始终保留审批步骤"},
        {"role": "assistant", "content": "收到"},
        {"role": "user", "content": "继续推进"},
        {"role": "assistant", "content": "正在整理"},
        {"role": "user", "content": "请继续"},
        {"role": "assistant", "content": "处理中"},
    ]
    _new_messages, did, summary, _count, _pending = asyncio.run(compactor.maybe_compact(messages, force=True))
    assert did is True
    assert "必须不要删除配置" in summary
    assert "始终保留审批步骤" in summary
    assert llm.calls >= 2

