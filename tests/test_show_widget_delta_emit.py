#!/usr/bin/env python3
"""Tests for show_widget progressive delta throttling helpers.

Author: Damon Li
"""

from __future__ import annotations

from typing import Dict

from agenticx.runtime.agent_runtime import _should_emit_show_widget_delta


def test_show_widget_delta_first_emit_and_no_growth() -> None:
    state: Dict[int, Dict[str, float]] = {}
    assert _should_emit_show_widget_delta(state, 0, "", now_mono=1.0) is True
    assert _should_emit_show_widget_delta(state, 0, "", now_mono=1.2) is False


def test_show_widget_delta_growth_respects_interval_and_chars() -> None:
    state: Dict[int, Dict[str, float]] = {}
    assert _should_emit_show_widget_delta(state, 0, "", now_mono=1.0) is True
    # +100 chars in 60ms: should still be throttled.
    assert _should_emit_show_widget_delta(state, 0, "x" * 100, now_mono=1.06) is False
    # Same growth but enough time elapsed.
    assert _should_emit_show_widget_delta(state, 0, "x" * 100, now_mono=1.2) is True
    # Large growth bypasses interval guard.
    assert _should_emit_show_widget_delta(state, 0, "x" * 1000, now_mono=1.22) is True


def test_show_widget_delta_force_flush_requires_new_data() -> None:
    state: Dict[int, Dict[str, float]] = {}
    assert _should_emit_show_widget_delta(state, 7, "", now_mono=3.0) is True
    assert _should_emit_show_widget_delta(state, 7, "", force=True, now_mono=3.1) is False
    assert _should_emit_show_widget_delta(state, 7, "<svg", force=True, now_mono=3.2) is True
