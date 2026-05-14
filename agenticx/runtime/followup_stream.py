#!/usr/bin/env python3
"""Strip <followups> blocks from assistant streams and final text.

Author: Damon Li
"""

from __future__ import annotations

from typing import List, Tuple

from agenticx.cli.config_manager import ConfigManager

FOLLOWUP_OPEN = "<followups>"
FOLLOWUP_CLOSE = "</followups>"

_OPEN_SUFFIXES: Tuple[str, ...] = tuple(FOLLOWUP_OPEN[:i] for i in range(1, len(FOLLOWUP_OPEN)))


def suggested_questions_enabled_from_config() -> bool:
    """Return True when UI follow-up chips should be generated."""
    raw = ConfigManager.get_value("runtime.suggested_questions.enabled")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return bool(int(raw))  # type: ignore[arg-type]


def visible_prefix_for_stream_buffer(full: str) -> str:
    """Return the longest safe prefix of *full* to show while streaming."""
    if FOLLOWUP_OPEN not in full:
        return _hold_partial_open_suffix(full)
    before, rest = full.split(FOLLOWUP_OPEN, 1)
    if FOLLOWUP_CLOSE in rest:
        _, after = rest.split(FOLLOWUP_CLOSE, 1)
        return (before + after).rstrip()
    return before.rstrip()


def _hold_partial_open_suffix(s: str) -> str:
    if not s:
        return ""
    for suf in reversed(_OPEN_SUFFIXES):
        if len(suf) <= len(s) and s.endswith(suf):
            return s[: -len(suf)]
    return s


def split_final_answer_and_followups(full: str) -> Tuple[str, List[str]]:
    """Split raw assistant text into user-visible body and up to 3 follow-up lines."""
    if FOLLOWUP_OPEN not in full:
        return full.strip(), []
    before, rest = full.split(FOLLOWUP_OPEN, 1)
    if FOLLOWUP_CLOSE not in rest:
        return before.strip(), []
    body, after = rest.split(FOLLOWUP_CLOSE, 1)
    body_clean = body.strip()
    tail = after.strip()
    merged = before.rstrip()
    if tail:
        merged = f"{merged}\n\n{tail}".strip() if merged else tail
    else:
        merged = merged.strip()
    lines: List[str] = []
    for line in body_clean.splitlines():
        t = line.strip()
        if t:
            lines.append(t)
        if len(lines) >= 3:
            break
    return merged, lines[:3]


class FollowupStreamEmitter:
    """Emit only visible token deltas while accumulating raw assistant text."""

    __slots__ = ("_enabled", "_raw", "_emitted_visible_len")

    def __init__(self, enabled: bool) -> None:
        self._enabled = enabled
        self._raw = ""
        self._emitted_visible_len = 0

    def reset(self) -> None:
        self._raw = ""
        self._emitted_visible_len = 0

    @property
    def raw(self) -> str:
        return self._raw

    def feed_append(self, token: str) -> str:
        """Append *token* to raw buffer; return new visible suffix to stream."""
        if not token:
            return ""
        self._raw += token
        if not self._enabled:
            delta = self._raw[self._emitted_visible_len :]
            self._emitted_visible_len = len(self._raw)
            return delta
        vis = visible_prefix_for_stream_buffer(self._raw)
        delta = vis[self._emitted_visible_len :]
        self._emitted_visible_len = len(vis)
        return delta

    def finalize_text(self) -> Tuple[str, List[str]]:
        """Return cleaned body + suggestions from accumulated raw."""
        if not self._enabled:
            return (self._raw or "").strip(), []
        return split_final_answer_and_followups(self._raw)
