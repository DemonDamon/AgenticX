#!/usr/bin/env python3
"""Extract mid-turn assistant text + tool progress from CC / CodeBuddy stream-json.

Both CLIs emit NDJSON on stdout. With ``--include-partial-messages`` they also
emit ``type=stream_event`` frames whose ``content_block_delta`` / ``text_delta``
chunks are true token increments. Without that flag (or for models that only
post complete blocks), ``type=assistant`` messages carry full text blocks that
still arrive *before* the terminal ``type=result`` line.

Tool progress (name + status only) comes from:
- ``stream_event`` / ``content_block_start`` with ``content_block.type=tool_use``
- ``assistant`` message ``tool_use`` content blocks (deduped by id)
- ``user`` message ``tool_result`` content blocks (end / error)

Near's external-harness SSE path uses this module to forward visible assistant
text as ``token`` events and tool rows as builtin-compatible ``tool_call`` /
``tool_result`` events while ``wait_for_success_result`` / ``wait_for_turn``
still own final-turn correctness.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Literal, Optional

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


@dataclass(frozen=True)
class ToolProgressEvent:
    """One tool start/end observed in stream-json (no arg/result dumps)."""

    kind: Literal["start", "end"]
    tool_call_id: str
    name: str = ""
    is_error: bool = False


@dataclass
class ToolProgressTracker:
    """Dedupe tool start/end ids within one turn so partial + assistant do not double-fire."""

    seen_starts: set[str] = field(default_factory=set)
    seen_ends: set[str] = field(default_factory=set)
    names_by_id: Dict[str, str] = field(default_factory=dict)

    def reset(self) -> None:
        self.seen_starts.clear()
        self.seen_ends.clear()
        self.names_by_id.clear()

    def note_name(self, tool_call_id: str, name: str) -> None:
        tid = str(tool_call_id or "").strip()
        nm = str(name or "").strip()
        if tid and nm:
            self.names_by_id[tid] = nm

    def start(self, tool_call_id: str, name: str = "") -> Optional[ToolProgressEvent]:
        tid = str(tool_call_id or "").strip()
        if not tid or tid in self.seen_starts:
            return None
        self.seen_starts.add(tid)
        nm = str(name or "").strip() or self.names_by_id.get(tid, "")
        if nm:
            self.names_by_id[tid] = nm
        return ToolProgressEvent(kind="start", tool_call_id=tid, name=nm or "tool")

    def end(
        self,
        tool_call_id: str,
        *,
        name: str = "",
        is_error: bool = False,
    ) -> Optional[ToolProgressEvent]:
        tid = str(tool_call_id or "").strip()
        if not tid or tid in self.seen_ends:
            return None
        self.seen_ends.add(tid)
        nm = (
            str(name or "").strip()
            or self.names_by_id.get(tid, "")
            or "tool"
        )
        if nm and nm != "tool":
            self.names_by_id[tid] = nm
        return ToolProgressEvent(
            kind="end",
            tool_call_id=tid,
            name=nm,
            is_error=bool(is_error),
        )


def iter_raw_tool_progress(line: str) -> Iterable[ToolProgressEvent]:
    """Yield raw (possibly duplicate) tool start/end events from one stream-json line.

    Recognized shapes:
    - ``stream_event`` → ``content_block_start`` → ``content_block.type=tool_use``
    - ``assistant`` → ``message.content`` items with ``type=tool_use``
    - ``user`` → ``message.content`` items with ``type=tool_result``

    Never yields tool argument JSON or large result bodies — only id/name/status.
    """
    obj = parse_stream_json_object(line)
    if obj is None:
        return

    kind = obj.get("type")
    if kind == "stream_event":
        event = obj.get("event")
        if not isinstance(event, dict):
            return
        if event.get("type") != "content_block_start":
            return
        block = event.get("content_block")
        if not isinstance(block, dict):
            return
        if block.get("type") != "tool_use":
            return
        tid = str(block.get("id") or "").strip()
        name = str(block.get("name") or "").strip()
        if tid:
            yield ToolProgressEvent(kind="start", tool_call_id=tid, name=name or "tool")
        return

    if kind == "assistant":
        message = obj.get("message")
        if not isinstance(message, dict):
            return
        content = message.get("content")
        if not isinstance(content, list):
            return
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_use":
                continue
            tid = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            if tid:
                yield ToolProgressEvent(kind="start", tool_call_id=tid, name=name or "tool")
        return

    if kind == "user":
        message = obj.get("message")
        if not isinstance(message, dict):
            return
        content = message.get("content")
        if not isinstance(content, list):
            return
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_result":
                continue
            tid = str(
                item.get("tool_use_id")
                or item.get("toolUseId")
                or item.get("tool_call_id")
                or item.get("id")
                or ""
            ).strip()
            if not tid:
                continue
            is_error = bool(item.get("is_error") or item.get("isError"))
            yield ToolProgressEvent(
                kind="end",
                tool_call_id=tid,
                name="",
                is_error=is_error,
            )


@dataclass
class MidTurnItem:
    """Ordered mid-turn stream item for Near SSE (text or tool progress)."""

    kind: Literal["text", "tool_start", "tool_end"]
    text: str = ""
    tool_call_id: str = ""
    name: str = ""
    is_error: bool = False


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


def drain_midturn_items_from_lines(
    lines: List[str],
    *,
    start_index: int,
    text_tracker: VisibleTextTracker,
    tool_tracker: Optional[ToolProgressTracker] = None,
) -> tuple[List[MidTurnItem], int]:
    """Process ``lines[start_index:]`` into ordered text + tool progress items.

    Returns ``(items, new_index)``. Tool events are deduped via ``tool_tracker``.
    """
    if start_index < 0:
        start_index = 0
    if start_index > len(lines):
        start_index = len(lines)
    tools = tool_tracker if tool_tracker is not None else ToolProgressTracker()
    items: List[MidTurnItem] = []
    for line in lines[start_index:]:
        for raw in iter_raw_tool_progress(line):
            if raw.kind == "start":
                ev = tools.start(raw.tool_call_id, raw.name)
            else:
                ev = tools.end(
                    raw.tool_call_id,
                    name=raw.name,
                    is_error=raw.is_error,
                )
            if ev is None:
                continue
            items.append(
                MidTurnItem(
                    kind="tool_start" if ev.kind == "start" else "tool_end",
                    tool_call_id=ev.tool_call_id,
                    name=ev.name,
                    is_error=ev.is_error,
                )
            )

        obj = parse_stream_json_object(line)
        is_assistant = bool(obj and obj.get("type") == "assistant")
        is_block_stop = False
        if obj and obj.get("type") == "stream_event":
            event = obj.get("event")
            if isinstance(event, dict) and event.get("type") == "content_block_stop":
                is_block_stop = True
        for frag in iter_raw_text_fragments(line):
            delta = text_tracker.feed(frag, release=is_assistant)
            if delta:
                items.append(MidTurnItem(kind="text", text=delta))
        # Release on assistant message or content_block_stop so no-think
        # models still paint the bubble before the terminal result line.
        if is_assistant or is_block_stop:
            delta = text_tracker.feed("", release=True)
            if delta:
                items.append(MidTurnItem(kind="text", text=delta))
    return items, len(lines)


def drain_visible_text_from_lines(
    lines: List[str],
    *,
    start_index: int,
    tracker: VisibleTextTracker,
    tool_tracker: Optional[ToolProgressTracker] = None,
) -> tuple[str, int]:
    """Process ``lines[start_index:]`` through ``tracker``.

    Returns ``(joined_visible_delta, new_index)``.
    """
    items, new_index = drain_midturn_items_from_lines(
        lines,
        start_index=start_index,
        text_tracker=tracker,
        tool_tracker=tool_tracker,
    )
    parts = [item.text for item in items if item.kind == "text" and item.text]
    return "".join(parts), new_index


__all__ = [
    "MidTurnItem",
    "ToolProgressEvent",
    "ToolProgressTracker",
    "VisibleTextTracker",
    "drain_midturn_items_from_lines",
    "drain_visible_text_from_lines",
    "iter_raw_text_fragments",
    "iter_raw_tool_progress",
    "parse_stream_json_object",
]
