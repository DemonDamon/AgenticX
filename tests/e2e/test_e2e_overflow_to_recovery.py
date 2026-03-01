#!/usr/bin/env python3
"""E2E: execute overflow and recover across L1/L2/L3.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

from agenticx.core.event import EventLog
from agenticx.core.event import ToolResultEvent
from agenticx.core.overflow_recovery import OverflowRecoveryConfig
from agenticx.core.overflow_recovery import OverflowRecoveryPipeline


class _DummyCounter:
    def count_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)


class _DummyCompiler:
    def __init__(self, compact_returns: list[object], fast_return: object):
        self.token_counter = _DummyCounter()
        self._compact_returns = compact_returns
        self._fast_return = fast_return
        self.compact_calls = 0
        self.fast_calls = 0

    async def compact(self, event_log: EventLog, reason: str = "") -> object:
        _ = event_log, reason
        idx = self.compact_calls
        self.compact_calls += 1
        if idx < len(self._compact_returns):
            return self._compact_returns[idx]
        return None

    def _fast_compress(self, event_log: EventLog, reason: str = "") -> object:
        _ = event_log, reason
        self.fast_calls += 1
        return self._fast_return


def test_e2e_overflow_recovery_progresses_levels():
    event_log = EventLog(agent_id="agent-1", task_id="task-1")
    event_log.append(
        ToolResultEvent(
            tool_name="heavy_tool",
            success=True,
            result="x" * 50000,
            agent_id="agent-1",
            task_id="task-1",
        )
    )
    compiler = _DummyCompiler(compact_returns=[None, {"ok": "l2"}], fast_return={"ok": "l3"})
    pipeline = OverflowRecoveryPipeline(
        compiler=compiler,
        config=OverflowRecoveryConfig(
            l1_enabled=True,
            l1_max_result_tokens=120,
            l2_max_attempts=2,
            l3_enabled=True,
        ),
    )

    # First call should succeed at L1 by truncating oversized tool output.
    assert asyncio.run(pipeline.recover(event_log)) is True
    assert "truncated by overflow recovery" in str(event_log.events[0].result)
    assert compiler.compact_calls == 0
    assert compiler.fast_calls == 0

    # Once L1 already attempted, next call goes to L2.
    assert asyncio.run(pipeline.recover(event_log)) is True
    assert compiler.compact_calls == 2
    assert compiler.fast_calls == 0

    # Further attempt should reach L3 fallback path.
    compiler._compact_returns = [None, None]
    pipeline.reset()
    pipeline._l1_attempted = True  # simulate already-truncated workflow
    assert asyncio.run(pipeline.recover(event_log)) is True
    assert compiler.fast_calls == 1
