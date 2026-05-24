#!/usr/bin/env python3
"""Smoke tests for session token budget exceeded semantics.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.token_budget import (
    BudgetLevel,
    TokenBudgetGuard,
    resolve_token_budget_limits,
)


def test_token_budget_guard_exceeded_at_limit() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 600
    guard.cumulative_output = 450
    level, source, current, max_allowed = guard.check_with_source()
    assert level == BudgetLevel.EXCEEDED
    assert source == "session"
    assert current == 1050
    assert max_allowed == 1000


def test_resolve_token_budget_limits_defaults() -> None:
    session_limit, turn_limit = resolve_token_budget_limits()
    assert session_limit >= 100_000
    assert turn_limit >= 50_000


def test_resolve_token_budget_limits_explicit_override() -> None:
    session_limit, turn_limit = resolve_token_budget_limits(
        max_tokens_per_session=750_000,
        max_tokens_per_turn=120_000,
    )
    assert session_limit == 750_000
    assert turn_limit == 120_000
