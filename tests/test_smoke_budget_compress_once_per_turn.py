#!/usr/bin/env python3
"""Smoke tests: budget-triggered compaction runs at most once per turn.

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agenticx.runtime.agent_runtime import AgentRuntime
from agenticx.runtime.token_budget import BudgetLevel, TokenBudgetGuard


@pytest.mark.asyncio
async def test_budget_compress_latches_after_first_attempt() -> None:
    """Second COMPRESS check in the same turn must not re-call maybe_compact or re-warn."""
    runtime = AgentRuntime(llm=MagicMock(), confirm_gate=MagicMock())
    runtime.token_budget = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    runtime.token_budget.cumulative_input = 960
    runtime.token_budget.cumulative_output = 0

    compact_mock = AsyncMock(
        return_value=(
            [{"role": "system", "content": "[compacted] summary"}],
            True,
            "summary",
            3,
            "",
        )
    )
    runtime.compactor.maybe_compact = compact_mock  # type: ignore[method-assign]

    # Simulate two consecutive tool rounds in one turn.
    runtime._forced_budget_compact_this_turn = False
    runtime._budget_compress_notice_sent_this_turn = False

    level1, _, _, _ = runtime.token_budget.check_with_source()
    assert level1 == BudgetLevel.COMPRESS

    if level1 == BudgetLevel.COMPRESS and not runtime._forced_budget_compact_this_turn:
        runtime._forced_budget_compact_this_turn = True
        await runtime.compactor.maybe_compact([], force=True, model="gpt-4o")

    if level1 == BudgetLevel.COMPRESS and not runtime._budget_compress_notice_sent_this_turn:
        runtime._budget_compress_notice_sent_this_turn = True

    assert compact_mock.await_count == 1

    level2, _, _, _ = runtime.token_budget.check_with_source()
    assert level2 == BudgetLevel.COMPRESS

    if level2 == BudgetLevel.COMPRESS and not runtime._forced_budget_compact_this_turn:
        await runtime.compactor.maybe_compact([], force=True, model="gpt-4o")

    notice_would_emit = (
        level2 == BudgetLevel.COMPRESS and not runtime._budget_compress_notice_sent_this_turn
    )

    assert compact_mock.await_count == 1
    assert notice_would_emit is False


def test_run_turn_resets_budget_compress_latches() -> None:
    runtime = AgentRuntime(llm=MagicMock(), confirm_gate=MagicMock())
    runtime._forced_budget_compact_this_turn = True
    runtime._budget_compress_notice_sent_this_turn = True
    runtime.token_budget.reset_turn()
    runtime._forced_budget_compact_this_turn = False
    runtime._budget_compress_notice_sent_this_turn = False
    assert runtime._forced_budget_compact_this_turn is False
    assert runtime._budget_compress_notice_sent_this_turn is False
