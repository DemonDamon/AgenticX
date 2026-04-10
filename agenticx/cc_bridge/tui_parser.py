#!/usr/bin/env python3
"""Heuristic parsing of Claude Code TUI transcript for bridge visible_tui mode.

Author: Damon Li
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import List, Tuple

# ANSI / OSC / control chars (best-effort)
_ANSI_OR_CTRL_RE = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]"
    r"|\x1b\][^\x07]*(?:\x07|\x1b\\)"
    r"|\x1b[\[\]P\][\s\S]*?(?:\x07|\x1b\\)"
    r"|\x1b."
    r"|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]"
)

ANCHOR_PREFIX = "[agx_tui_anchor]"


def strip_ansi_and_controls(text: str) -> str:
    if not text:
        return ""
    return _ANSI_OR_CTRL_RE.sub("", text).replace("\r\n", "\n").replace("\r", "\n")


def _dedupe_consecutive_lines(lines: List[str]) -> List[str]:
    out: List[str] = []
    prev: str | None = None
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if s == prev:
            continue
        prev = s
        out.append(s)
    return out


@dataclass
class TuiParseResult:
    text: str
    confidence: float
    reason: str


def extract_after_anchor(raw_lines: List[str], anchor_substring: str) -> List[str]:
    """Return stripped text lines after the line containing anchor_substring."""
    idx = -1
    for i, line in enumerate(raw_lines):
        if anchor_substring in line:
            idx = i
    if idx < 0:
        return []
    chunk: List[str] = []
    for line in raw_lines[idx + 1 :]:
        clean = strip_ansi_and_controls(line)
        if not clean.strip():
            continue
        # Drop obvious echo of user prompt lines (heuristic)
        if clean.strip().startswith(ANCHOR_PREFIX):
            continue
        chunk.append(clean)
    return _dedupe_consecutive_lines(chunk)


def parse_visible_tui_tail(
    raw_lines: List[str],
    anchor_token: str,
    *,
    idle_seconds: float,
    max_wait_seconds: float,
    started_monotonic: float,
    now_monotonic: float,
) -> TuiParseResult:
    """Parse assistant-ish content after anchor; completion is decided by caller using idle time."""
    lines = extract_after_anchor(raw_lines, anchor_token)
    body = "\n".join(lines).strip()
    elapsed = now_monotonic - started_monotonic

    if not body:
        if elapsed >= max_wait_seconds:
            return TuiParseResult("", 0.0, "timeout_no_output")
        return TuiParseResult("", 0.15, "waiting")

    # Heuristic confidence: longer output + some idle => higher
    conf = 0.55
    if len(body) > 200:
        conf += 0.15
    if len(body) > 800:
        conf += 0.1
    if idle_seconds >= 1.5:
        conf += 0.1
    if idle_seconds >= 3.0:
        conf += 0.1
    conf = min(0.95, conf)

    reason = "ok" if idle_seconds >= 1.5 else "partial_stream"
    return TuiParseResult(body, conf, reason)


def monotonic_now() -> float:
    return time.monotonic()
