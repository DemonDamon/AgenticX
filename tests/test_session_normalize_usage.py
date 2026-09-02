#!/usr/bin/env python3
"""Tests that _normalize_messages keeps per-turn usage and model selection.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.session_manager import SessionManager


def test_normalize_messages_keeps_usage_and_model_selection() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "id": "a1",
                "role": "assistant",
                "content": "done",
                "provider": "moonshot",
                "model": "kimi-k2.6",
                "model_selection": "manual",
                "usage": {
                    "input_tokens": 1200,
                    "output_tokens": 340,
                    "cached_tokens": 80,
                    "reasoning_tokens": 0,
                    "total_tokens": 1540,
                },
            }
        ]
    )
    row = rows[0]
    assert row["provider"] == "moonshot"
    assert row["model"] == "kimi-k2.6"
    assert row["model_selection"] == "manual"
    assert row["usage"]["input_tokens"] == 1200
    assert row["usage"]["output_tokens"] == 340
    assert row["usage"]["cached_tokens"] == 80
    assert row["usage"]["total_tokens"] == 1540


def test_normalize_messages_backfills_total_and_drops_empty_usage() -> None:
    manager = SessionManager()
    filled = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "ok",
                "usage": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 0},
            }
        ]
    )
    assert filled[0]["usage"]["total_tokens"] == 3

    empty = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "ok",
                "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
            }
        ]
    )
    assert "usage" not in empty[0]
    assert "model_selection" not in empty[0]


def test_normalize_messages_accepts_auto_selection() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "ok",
                "model": "kimi-k2.6",
                "model_selection": "auto",
            }
        ]
    )
    assert rows[0]["model_selection"] == "auto"
