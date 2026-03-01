#!/usr/bin/env python3
"""Smoke tests for OpenClaw-inspired overflow recovery.

Author: Damon Li
"""

import asyncio

from agenticx.core.event import EventLog, ToolResultEvent
from agenticx.core.overflow_recovery import OverflowRecoveryConfig, OverflowRecoveryPipeline


class _DummyTokenCounter:
    def count_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)


class _DummyCompiler:
    def __init__(self, compact_results=None, fast_result=None):
        self.token_counter = _DummyTokenCounter()
        self._compact_results = compact_results or []
        self._fast_result = fast_result
        self.compact_calls = 0
        self.fast_calls = 0

    async def compact(self, event_log: EventLog, reason: str = ""):
        _ = event_log, reason
        idx = self.compact_calls
        self.compact_calls += 1
        if idx < len(self._compact_results):
            return self._compact_results[idx]
        return None

    def _fast_compress(self, event_log: EventLog, reason: str = ""):
        _ = event_log, reason
        self.fast_calls += 1
        return self._fast_result

    def _is_emergency(self, current_tokens: int) -> bool:
        _ = current_tokens
        return True

    def _count_event_log_tokens(self, event_log: EventLog) -> int:
        _ = event_log
        return 100000


def _make_log_with_large_tool_result() -> EventLog:
    event_log = EventLog(agent_id="a1", task_id="t1")
    event_log.append(
        ToolResultEvent(
            tool_name="read_file",
            success=True,
            result="x" * 30000,
            agent_id="a1",
            task_id="t1",
        )
    )
    return event_log


class TestOverflowRecoveryPipeline:
    def test_l1_truncate_success(self):
        compiler = _DummyCompiler(compact_results=[None], fast_result=None)
        pipeline = OverflowRecoveryPipeline(
            compiler=compiler,
            config=OverflowRecoveryConfig(l1_enabled=True, l1_max_result_tokens=100, l2_max_attempts=1),
        )
        log = _make_log_with_large_tool_result()

        ok = asyncio.run(pipeline.recover(log))

        assert ok is True
        assert compiler.compact_calls == 0
        assert "truncated by overflow recovery" in str(log.events[0].result)

    def test_l2_compaction_success(self):
        compiler = _DummyCompiler(compact_results=[None, {"ok": True}], fast_result=None)
        pipeline = OverflowRecoveryPipeline(
            compiler=compiler,
            config=OverflowRecoveryConfig(l1_enabled=False, l2_max_attempts=2, l3_enabled=False),
        )
        log = EventLog(agent_id="a1", task_id="t1")

        ok = asyncio.run(pipeline.recover(log))

        assert ok is True
        assert compiler.compact_calls == 2
        assert compiler.fast_calls == 0

    def test_l3_heuristic_fallback_success(self):
        compiler = _DummyCompiler(compact_results=[None, None], fast_result={"compressed": True})
        pipeline = OverflowRecoveryPipeline(
            compiler=compiler,
            config=OverflowRecoveryConfig(l1_enabled=False, l2_max_attempts=2, l3_enabled=True),
        )
        log = EventLog(agent_id="a1", task_id="t1")

        ok = asyncio.run(pipeline.recover(log))

        assert ok is True
        assert compiler.compact_calls == 2
        assert compiler.fast_calls == 1

    def test_all_levels_fail(self):
        compiler = _DummyCompiler(compact_results=[None], fast_result=None)
        pipeline = OverflowRecoveryPipeline(
            compiler=compiler,
            config=OverflowRecoveryConfig(l1_enabled=False, l2_max_attempts=1, l3_enabled=False),
        )
        log = EventLog(agent_id="a1", task_id="t1")

        ok = asyncio.run(pipeline.recover(log))

        assert ok is False
