#!/usr/bin/env python3
"""Extract mid-turn assistant text from Claude Code / CodeBuddy stream-json.

Both CLIs emit NDJSON on stdout. With ``--include-partial-messages`` they also
emit ``type=stream_event`` frames whose ``content_block_delta`` / ``text_delta``
chunks are true token increments. Without that flag (or for models that only
post complete blocks), ``type=assistant`` messages carry full text blocks that
still arrive *before* the terminal ``type=result`` line.

Near's external-harness SSE path uses this module to forward visible assistant
text as ``token`` events while ``wait_for_success_result`` /
``wait_for_turn`` still own final-turn correctness.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

import ujson

import re

from agenticx.harness.cc_result_sanitize import sanitize_claude_code_result_text

# Mirror cc_result_sanitize think-tag detection so mid-turn streaming can
# hold back tokens until a close tag arrives (sanitize alone strips the open
# tag and would otherwise leak the thinking body into the bubble).
_THINK_OPEN_RE = re.compile(
    r"<\s*(?:redacted[_-])?think(?:ing)?\b[^>]*>",
    re.IGNORECASE,
)
_THINK_CLOSE_RE = re.compile(
    r"</\s*(?:redacted[_-])?think(?:ing)?\s*>",
    re.IGNORECASE,
)


def _has_unclosed_think(raw: str) -> bool:
    """True when the latest think/redacted-thinking open has no later close."""
    last_open = None
    last_close = None
    for match in _THINK_OPEN_RE.finditer(raw):
        last_open = match
    for match in _THINK_CLOSE_RE.finditer(raw):
        last_close = match
    if last_open is None:
        return False
    if last_close is None:
        return True
    return last_open.start() > last_close.start()


def parse_stream_json_object(line: str) -> Optional[Dict[str, Any]]:
    """Parse one NDJSON stdout line into a dict, else None."""
    text = (line or "").strip()
    if not text or text.startswith("["):
        return None
    try:
        obj = ujson.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def _text_from_content_list(content: Any) -> str:
    """Join ``type=text`` parts from an assistant content list; skip tool_use."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: List[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "text":
            continue
        chunk = item.get("text")
        if chunk is None:
            continue
        parts.append(str(chunk))
    return "".join(parts)


def iter_raw_text_fragments(line: str) -> Iterable[str]:
    """Yield raw (unsanitized) assistant text fragments from one stream-json line.

    Recognized shapes:
    - ``stream_event`` → ``content_block_delta`` → ``text_delta.text``
    - ``assistant`` → ``message.content`` text blocks (tool_use ignored)

    Never yields tool_use JSON, system/init noise, or result payloads (final
    path still owns the sanitized ``result`` field).
    """
    obj = parse_stream_json_object(line)
    if obj is None:
        return

    kind = obj.get("type")
    if kind == "stream_event":
        event = obj.get("event")
        if not isinstance(event, dict):
            return
        if event.get("type") != "content_block_delta":
            return
        delta = event.get("delta")
        if not isinstance(delta, dict):
            return
        dtype = delta.get("type")
        if dtype is not None and dtype != "text_delta":
            # Ignore thinking_delta / input_json_delta / etc.
            return
        text = delta.get("text")
        if text is None:
            return
        fragment = str(text)
        if fragment:
            yield fragment
        return

    if kind == "assistant":
        message = obj.get("message")
        if not isinstance(message, dict):
            return
        fragment = _text_from_content_list(message.get("content"))
        if fragment:
            yield fragment


@dataclass
class VisibleTextTracker:
    """Accumulate raw stream fragments; emit only newly-visible sanitized text.

    Hold policy (matches final-turn sanitize intent):
    - Unclosed ``<think>`` / redacted-thinking blocks never emit.
    - Bare GLM-style thinking (no open tag, ends at ``</think>``) is held
      until the first think-close appears in ``raw``.
    - Full ``assistant`` message fragments pass ``release=True`` so models
      that never emit think tags still stream once the complete block lands
      (before the terminal ``result`` line).
    """

    raw: str = ""
    emitted: str = ""
    released: bool = False

    def feed(self, fragment: str, *, release: bool = False) -> str:
        """Ingest one raw fragment; return the next visible slice to append (or "")."""
        piece = str(fragment or "")
        if not piece and not release:
            return ""

        # Assistant message content is a *snapshot* of the visible text (or the
        # full block including thinking). Compare on sanitized visible text so
        # we never double-append a replay after token deltas.
        if release and piece:
            self.released = True
            snap_visible = sanitize_claude_code_result_text(piece)
            if not snap_visible:
                return ""
            if snap_visible.startswith(self.emitted):
                delta = snap_visible[len(self.emitted) :]
                self.emitted = snap_visible
                # Prefer the longer raw that still sanitizes to the snapshot.
                if len(piece) >= len(self.raw):
                    self.raw = piece
                return delta
            if self.emitted.startswith(snap_visible):
                return ""
            self.emitted = snap_visible
            self.raw = piece
            return ""

        # Token deltas / think-close path: append and maybe release.
        if piece and self.raw and piece.startswith(self.raw):
            piece = piece[len(self.raw) :]
            if not piece and not release:
                return ""
        elif piece and self.raw and self.raw.startswith(piece):
            piece = ""

        if piece:
            self.raw += piece
        if release:
            self.released = True
        if _THINK_CLOSE_RE.search(self.raw):
            self.released = True
        if _has_unclosed_think(self.raw):
            return ""
        if not self.released:
            return ""
        visible = sanitize_claude_code_result_text(self.raw)
        if not visible:
            return ""
        if visible.startswith(self.emitted):
            delta = visible[len(self.emitted) :]
            self.emitted = visible
            return delta
        # Sanitize changed the visible prefix (rare). Do not append a divergent
        # slice — ``final`` SSE replaces the bubble authoritatively.
        self.emitted = visible
        return ""

    def reset(self) -> None:
        self.raw = ""
        self.emitted = ""
        self.released = False


def drain_visible_text_from_lines(
    lines: List[str],
    *,
    start_index: int,
    tracker: VisibleTextTracker,
) -> tuple[str, int]:
    """Process ``lines[start_index:]`` through ``tracker``.

    Returns ``(joined_visible_delta, new_index)``.
    """
    if start_index < 0:
        start_index = 0
    if start_index > len(lines):
        start_index = len(lines)
    parts: List[str] = []
    for line in lines[start_index:]:
        obj = parse_stream_json_object(line)
        is_assistant = bool(obj and obj.get("type") == "assistant")
        is_block_stop = False
        if obj and obj.get("type") == "stream_event":
            event = obj.get("event")
            if isinstance(event, dict) and event.get("type") == "content_block_stop":
                is_block_stop = True
        for frag in iter_raw_text_fragments(line):
            delta = tracker.feed(frag, release=is_assistant)
            if delta:
                parts.append(delta)
        # Release on assistant message or content_block_stop so no-think
        # models still paint the bubble before the terminal result line.
        if is_assistant or is_block_stop:
            delta = tracker.feed("", release=True)
            if delta:
                parts.append(delta)
    return "".join(parts), len(lines)


__all__ = [
    "VisibleTextTracker",
    "drain_visible_text_from_lines",
    "iter_raw_text_fragments",
    "parse_stream_json_object",
]
