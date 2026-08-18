#!/usr/bin/env python3
"""Smoke tests for session token budget exceeded semantics.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.token_budget import (
    BudgetLevel,
    DEFAULT_MAX_TOKENS_PER_SESSION,
    DEFAULT_WARNING_TOKENS_PER_SESSION,
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


def test_resolve_token_budget_limits_defaults(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "_load_yaml", lambda _path: {})
    monkeypatch.delenv("AGX_MAX_TOKENS_PER_SESSION", raising=False)
    monkeypatch.delenv("AGX_MAX_TOKENS_PER_TURN", raising=False)
    session_limit, turn_limit = resolve_token_budget_limits()
    assert DEFAULT_MAX_TOKENS_PER_SESSION == 1_000_000
    assert DEFAULT_WARNING_TOKENS_PER_SESSION == 500_000
    assert session_limit == 1_000_000
    assert turn_limit == 100_000


def test_session_warning_threshold_is_fixed_at_500k() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=2_000_000, max_tokens_per_turn=2_000_000)
    guard.cumulative_input = 499_999
    assert guard.check_session() == BudgetLevel.OK
    guard.cumulative_input = 500_000
    assert guard.check_session() == BudgetLevel.WARNING


def test_restore_usage_keeps_fresh_configured_limits() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=2_000_000, max_tokens_per_turn=300_000)
    guard.restore_usage(
        {
            "cumulative_input": 700_000,
            "cumulative_output": 10_000,
            "warning_emitted": True,
            "max_session": 500_000,
            "max_turn": 50_000,
        }
    )
    assert guard.cumulative_total == 710_000
    assert guard.warning_emitted is True
    assert guard.max_session == 2_000_000
    assert guard.max_turn == 300_000


def test_resolve_token_budget_limits_explicit_override() -> None:
    session_limit, turn_limit = resolve_token_budget_limits(
        max_tokens_per_session=750_000,
        max_tokens_per_turn=120_000,
    )
    assert session_limit == 750_000
    assert turn_limit == 120_000
