#!/usr/bin/env python3
"""Smoke tests for non-blocking session token warning semantics.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.token_budget import (
    BudgetLevel,
    DEFAULT_MAX_TOKENS_PER_SESSION,
    DEFAULT_WARNING_TOKENS_PER_SESSION,
    TokenBudgetGuard,
    resolve_token_budget_limits,
    resolve_token_budget_settings,
)


def test_token_budget_guard_is_red_at_second_session_threshold() -> None:
    guard = TokenBudgetGuard(max_tokens_per_session=1000, max_tokens_per_turn=500)
    guard.cumulative_input = 600
    guard.cumulative_output = 450
    level, source, current, max_allowed = guard.check_with_source()
    assert level == BudgetLevel.RED
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


def test_resolve_token_budget_settings_defaults(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "_load_yaml", lambda _path: {})
    monkeypatch.delenv("AGX_WARNING_TOKENS_PER_SESSION", raising=False)
    session_limit, warning_limit, turn_limit = resolve_token_budget_settings()
    assert (session_limit, warning_limit, turn_limit) == (1_000_000, 500_000, 100_000)


def test_session_warning_threshold_is_configurable() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=2_000_000,
        warning_tokens_per_session=700_000,
        max_tokens_per_turn=2_000_000,
    )
    guard.cumulative_input = 699_999
    assert guard.check_session() == BudgetLevel.OK
    guard.cumulative_input = 700_000
    assert guard.check_session() == BudgetLevel.YELLOW


def test_guard_reads_warning_threshold_from_runtime_config(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda _path: {
            "runtime": {
                "token_budget": {
                    "warning_tokens_per_session": 700_000,
                    "max_tokens_per_session": 1_200_000,
                    "max_tokens_per_turn": 150_000,
                }
            }
        },
    )
    guard = TokenBudgetGuard()
    assert guard.warning_session == 700_000
    assert guard.max_session == 1_200_000
    guard.cumulative_input = 700_000
    assert guard.check_session() == BudgetLevel.YELLOW


def test_local_500k_red_threshold_is_preserved_without_migration(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda _path: {
            "runtime": {
                "token_budget": {
                    "warning_tokens_per_session": 250_000,
                    "max_tokens_per_session": 500_000,
                }
            }
        },
    )
    assert resolve_token_budget_settings()[:2] == (500_000, 250_000)


def test_authenticated_enterprise_policy_overrides_local_limits(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda _path: {
            "enterprise": {
                "enabled": True,
                "token": "signed-token",
                "policy": {
                    "token_budget": {
                        "warning_tokens_per_session": 600_000,
                        "max_tokens_per_session": 1_200_000,
                    }
                },
            },
            "runtime": {
                "token_budget": {
                    "warning_tokens_per_session": 250_000,
                    "max_tokens_per_session": 500_000,
                }
            }
        },
    )
    assert resolve_token_budget_settings()[:2] == (1_200_000, 600_000)


def test_remembered_enterprise_address_without_login_uses_local_limits(monkeypatch) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda _path: {
            "enterprise": {
                "enabled": True,
                "base_url": "https://enterprise.example",
                "policy": {
                    "token_budget": {
                        "warning_tokens_per_session": 600_000,
                        "max_tokens_per_session": 1_200_000,
                    }
                },
            },
            "runtime": {
                "token_budget": {
                    "warning_tokens_per_session": 250_000,
                    "max_tokens_per_session": 500_000,
                }
            },
        },
    )
    assert resolve_token_budget_settings()[:2] == (500_000, 250_000)


def test_changed_warning_threshold_resets_only_the_warning_latch() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=1_000_000,
        warning_tokens_per_session=700_000,
        max_tokens_per_turn=100_000,
    )
    guard.restore_usage(
        {
            "cumulative_input": 600_000,
            "warning_emitted": True,
            "warning_emitted_at": 500_000,
        }
    )
    assert guard.cumulative_total == 600_000
    assert guard.warning_emitted is False

    guard.restore_usage(
        {
            "cumulative_input": 700_000,
            "warning_emitted": True,
            "warning_emitted_at": 700_000,
        }
    )
    assert guard.warning_emitted is True


def test_changed_red_threshold_resets_only_the_red_latch() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=1_000_000,
        warning_tokens_per_session=500_000,
        max_tokens_per_turn=100_000,
    )
    guard.restore_usage(
        {
            "cumulative_input": 1_100_000,
            "yellow_emitted": True,
            "yellow_emitted_at": 500_000,
            "red_emitted": True,
            "red_emitted_at": 900_000,
        }
    )
    assert guard.yellow_emitted is True
    assert guard.red_emitted is False

    guard.restore_usage(
        {
            "cumulative_input": 1_100_000,
            "yellow_emitted": True,
            "yellow_emitted_at": 500_000,
            "red_emitted": True,
            "red_emitted_at": 1_000_000,
        }
    )
    assert guard.yellow_emitted is True
    assert guard.red_emitted is True


def test_session_red_level_never_becomes_compress_or_exceeded() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=1_000,
        warning_tokens_per_session=500,
        max_tokens_per_turn=2_000_000,
    )
    guard.cumulative_input = 10_000_000

    assert guard.check_session() == BudgetLevel.RED
    assert guard.check_with_source()[0] == BudgetLevel.RED


def test_explicit_per_turn_hard_limit_still_dominates_session_red(monkeypatch) -> None:
    monkeypatch.setenv("AGX_ENFORCE_TURN_TOKEN_BUDGET", "1")
    guard = TokenBudgetGuard(
        max_tokens_per_session=1_000,
        warning_tokens_per_session=500,
        max_tokens_per_turn=100,
    )
    guard.cumulative_input = 2_000
    guard.turn_input = 101

    level, source, current, max_allowed = guard.check_with_source()
    assert level == BudgetLevel.EXCEEDED
    assert source == "turn"
    assert current == 101
    assert max_allowed == 100


def test_restore_usage_ignores_corrupt_warning_latch_threshold() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=1_000_000,
        warning_tokens_per_session=500_000,
        max_tokens_per_turn=100_000,
    )

    guard.restore_usage(
        {
            "cumulative_input": 600_000,
            "warning_emitted": True,
            "warning_emitted_at": {"invalid": True},
        }
    )

    assert guard.cumulative_total == 600_000
    assert guard.warning_emitted is False


def test_restore_usage_keeps_fresh_configured_limits() -> None:
    guard = TokenBudgetGuard(
        max_tokens_per_session=2_000_000,
        warning_tokens_per_session=500_000,
        max_tokens_per_turn=300_000,
    )
    guard.restore_usage(
        {
            "cumulative_input": 700_000,
            "cumulative_output": 10_000,
            "warning_emitted": True,
            "warning_emitted_at": 500_000,
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
