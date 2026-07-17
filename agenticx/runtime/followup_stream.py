#!/usr/bin/env python3
"""Strip <followups> blocks from assistant streams and final text.

Author: Damon Li
"""

from __future__ import annotations

from typing import List, Tuple

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.assistant_output import (
    AssistantOutputStreamParser,
    parse_assistant_output,
    strip_model_control_artifacts,
)

# Re-export for existing import paths (avoid circular imports at call sites).
__all__ = [
    "FollowupStreamEmitter",
    "split_final_answer_and_followups",
    "strip_model_control_artifacts",
    "suggested_questions_enabled_from_config",
    "visible_prefix_for_stream_buffer",
]

FOLLOWUP_OPEN = "<followups>"
FOLLOWUP_CLOSE = "</followups>"


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
    parser = AssistantOutputStreamParser()
    return parser.feed(full)


def split_final_answer_and_followups(full: str) -> Tuple[str, List[str]]:
    """Split raw assistant text into user-visible body and follow-up lines."""
    parsed = parse_assistant_output(full)
    return parsed.visible_body.strip(), list(parsed.suggested_questions)


class FollowupStreamEmitter:
    """Emit only visible token deltas while accumulating raw assistant text."""

    __slots__ = ("_enabled", "_raw", "_parser", "_emitted_visible_len")

    def __init__(self, enabled: bool) -> None:
        self._enabled = enabled
        self._raw = ""
        self._parser = AssistantOutputStreamParser()
        self._emitted_visible_len = 0

    def reset(self) -> None:
        self._raw = ""
        self._parser = AssistantOutputStreamParser()
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
        delta = self._parser.feed(token)
        return delta

    def finalize_text(self) -> Tuple[str, List[str]]:
        """Return cleaned body + suggestions from accumulated raw."""
        if not self._enabled:
            return (self._raw or "").strip(), []
        parsed = self._parser.finalize()
        return parsed.visible_body.strip(), list(parsed.suggested_questions)
