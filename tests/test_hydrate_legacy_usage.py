#!/usr/bin/env python3
"""Hydrate old turn-sum usage rows from the per-request ledger.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.usage_metadata import hydrate_legacy_message_usage


def test_hydrate_last_turn_uses_last_request_not_sum() -> None:
    rows = [
        {
            "role": "user",
            "timestamp": 1788593122878,
            "content": "start acceptEdits",
        },
        {"role": "tool", "timestamp": 1788593124852, "content": "{}"},
        {
            "role": "assistant",
            "timestamp": 1788593188943,
            "content": "done",
            "usage": {
                "input_tokens": 78821,
                "output_tokens": 666,
                "cached_tokens": 62848,
                "reasoning_tokens": 0,
                "total_tokens": 79487,
            },
        },
    ]
    events = [
        (1788593124751, 25777, 58, 11008),
        (1788593127370, 25933, 263, 25728),
        (1788593188950, 27111, 345, 26112),
    ]
    hydrate_legacy_message_usage(rows, events)
    usage = rows[-1]["usage"]
    assert usage["input_tokens"] == 27111
    assert usage["output_tokens"] == 345
    assert usage["cached_tokens"] == 26112
    assert usage["total_tokens"] == 27456
    assert usage["turn_input_tokens"] == 78821
    assert usage["turn_output_tokens"] == 666
    assert usage["turn_cached_tokens"] == 62848


def test_hydrate_skips_rows_that_already_split_turn_usage() -> None:
    rows = [
        {"role": "user", "timestamp": 10, "content": "q"},
        {
            "role": "assistant",
            "timestamp": 20,
            "content": "a",
            "usage": {
                "input_tokens": 27111,
                "output_tokens": 345,
                "cached_tokens": 26112,
                "total_tokens": 27456,
                "turn_input_tokens": 78821,
            },
        },
    ]
    events = [(15, 25777, 58, 11008), (20, 27111, 345, 26112)]
    hydrate_legacy_message_usage(rows, events)
    assert rows[-1]["usage"]["input_tokens"] == 27111
    assert rows[-1]["usage"]["turn_input_tokens"] == 78821


def test_hydrate_leaves_single_request_row_unchanged() -> None:
    rows = [
        {"role": "user", "timestamp": 10, "content": "q"},
        {
            "role": "assistant",
            "timestamp": 20,
            "content": "a",
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 40,
                "cached_tokens": 100,
                "total_tokens": 1240,
            },
        },
    ]
    events = [(18, 1200, 40, 100)]
    hydrate_legacy_message_usage(rows, events)
    usage = rows[-1]["usage"]
    assert usage["input_tokens"] == 1200
    assert "turn_input_tokens" not in usage
