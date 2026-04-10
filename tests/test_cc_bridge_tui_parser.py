#!/usr/bin/env python3
"""Unit tests for CC bridge visible TUI transcript parser.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cc_bridge.tui_parser import (
    ANCHOR_PREFIX,
    extract_after_anchor,
    parse_visible_tui_tail,
    strip_ansi_and_controls,
)


def test_strip_ansi_and_controls_basic() -> None:
    raw = "\x1b[32mhello\x1b[0m\r\nworld"
    assert strip_ansi_and_controls(raw) == "hello\nworld"


def test_extract_after_anchor_skips_anchor_echo() -> None:
    token = "anchor-uuid-1"
    lines = [
        f"{ANCHOR_PREFIX} {token}",
        "first line",
        "second line",
        f"{ANCHOR_PREFIX} other",
        "third",
    ]
    out = extract_after_anchor(lines, token)
    assert "first line" in out
    assert "second line" in out
    assert "third" in out


def test_parse_visible_tui_tail_waiting_short_elapsed() -> None:
    token = "t-1"
    raw = [f"{ANCHOR_PREFIX} {token}", "answer bit"]
    r = parse_visible_tui_tail(
        raw,
        token,
        idle_seconds=0.1,
        max_wait_seconds=60.0,
        started_monotonic=0.0,
        now_monotonic=1.0,
    )
    assert r.text == "answer bit"
    assert r.confidence < 0.9
    assert r.reason == "partial_stream"


def test_parse_visible_tui_tail_high_idle_confidence() -> None:
    token = "t-2"
    body = "x" * 250
    raw = [f"{ANCHOR_PREFIX} {token}", body]
    r = parse_visible_tui_tail(
        raw,
        token,
        idle_seconds=3.5,
        max_wait_seconds=60.0,
        started_monotonic=0.0,
        now_monotonic=10.0,
    )
    assert body in r.text
    assert r.confidence >= 0.8
    assert r.reason == "ok"


def test_parse_visible_tui_tail_timeout_empty() -> None:
    token = "t-3"
    raw: list[str] = []
    r = parse_visible_tui_tail(
        raw,
        token,
        idle_seconds=0.0,
        max_wait_seconds=5.0,
        started_monotonic=0.0,
        now_monotonic=10.0,
    )
    assert r.text == ""
    assert r.confidence == 0.0
    assert "timeout" in r.reason
