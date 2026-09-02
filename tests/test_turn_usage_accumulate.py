#!/usr/bin/env python3
"""Tests for per-turn usage accumulation helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.usage_metadata import (
    add_usage_dicts,
    empty_usage_dict,
    usage_dict_has_counts,
)


def test_empty_usage_has_no_counts() -> None:
    assert usage_dict_has_counts(None) is False
    assert usage_dict_has_counts(empty_usage_dict()) is False


def test_add_usage_dicts_single_round() -> None:
    summed = add_usage_dicts(
        None,
        {
            "input_tokens": 800,
            "output_tokens": 200,
            "cached_tokens": 10,
            "reasoning_tokens": 0,
            "total_tokens": 1000,
        },
    )
    assert summed["input_tokens"] == 800
    assert summed["output_tokens"] == 200
    assert summed["cached_tokens"] == 10
    assert summed["total_tokens"] == 1000
    assert usage_dict_has_counts(summed) is True


def test_add_usage_dicts_three_rounds_not_last_call_only() -> None:
    acc = empty_usage_dict()
    acc = add_usage_dicts(
        acc,
        {"input_tokens": 800, "output_tokens": 200, "total_tokens": 1000},
    )
    acc = add_usage_dicts(
        acc,
        {"input_tokens": 400, "output_tokens": 100, "total_tokens": 500},
    )
    acc = add_usage_dicts(
        acc,
        {"input_tokens": 200, "output_tokens": 50, "total_tokens": 250},
    )
    assert acc["input_tokens"] == 1400
    assert acc["output_tokens"] == 350
    assert acc["total_tokens"] == 1750
    last_only = {"input_tokens": 200, "output_tokens": 50, "total_tokens": 250}
    assert acc["total_tokens"] != last_only["total_tokens"]


def test_add_usage_dicts_backfills_total() -> None:
    summed = add_usage_dicts(
        {"input_tokens": 10, "output_tokens": 5, "total_tokens": 0},
        {"input_tokens": 2, "output_tokens": 3, "total_tokens": 0},
    )
    assert summed["total_tokens"] == 20
