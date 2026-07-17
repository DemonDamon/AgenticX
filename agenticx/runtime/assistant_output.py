"""Canonical assistant output parser for think/followups protocol.

Single-pass tag state machine shared by Runtime, Studio, and Desktop mirrors.
Author: Damon Li
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

# MiniMax models can leak mangled chat-template control tokens (e.g.
# ``]<]minimax[>[`` or ``<minimax_end>``) into generated text — including the
# tail of a <followups> line. Strip only the bracket/angle-wrapped forms so a
# legitimate plain "MiniMax" word in prose is never touched.
_MINIMAX_ARTIFACT_RE = re.compile(
    r"[\]\[<>~!|]+\s*/?\s*minimax[a-z_:]*\s*[\]\[<>~!|]*",
    re.IGNORECASE,
)

_ZERO_WIDTH_RE = re.compile(
    r"[\u200b\u200c\u200d\u2060\ufeff\u00ad]",
)
_RESERVED_TAG_TOKEN_RE = re.compile(
    r"</?\s*think\b|</?\s*followups\b",
    re.IGNORECASE,
)
_CONTROL_CHAR_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]",
)

_TAG_NAME_RE = re.compile(
    r"^(?P<closing>/?)\s*"
    r"(?P<name>think|followups)\b"
    r"(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)

_PROTOCOL_ERROR_ORDER = (
    "nested_reserved_tag",
    "mismatched_close",
    "stray_close",
    "unclosed_think",
    "unclosed_followups",
    "multiple_followups",
    "noncanonical_reserved_tag",
    "missing_visible_body",
    "invalid_followup_count",
    "invalid_followup_line",
)


@dataclass(frozen=True)
class ParsedAssistantOutput:
    """Normalized assistant turn: reasoning, body, suggestions, protocol errors."""

    reasoning: str
    visible_body: str
    suggested_questions: tuple[str, ...]
    protocol_errors: tuple[str, ...]

    @property
    def malformed(self) -> bool:
        return bool(self.protocol_errors)


def strip_model_control_artifacts(text: str) -> str:
    """Remove bracket-wrapped MiniMax control-token residue from *text*."""
    if not text or "minimax" not in text.lower():
        return text
    return _MINIMAX_ARTIFACT_RE.sub("", text).strip()


def sanitize_public_tool_summary(raw: str) -> str | None:
    """Return a user-safe public tool message, or None when unsafe."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    if _ZERO_WIDTH_RE.search(text) or _CONTROL_CHAR_RE.search(text):
        return None
    if _RESERVED_TAG_TOKEN_RE.search(text):
        return None
    # Reject noncanonical reserved-tag shapes such as ``< Think >``.
    if _contains_noncanonical_reserved_tag(text):
        return None
    cleaned = strip_model_control_artifacts(text)
    if not cleaned or cleaned != text and _RESERVED_TAG_TOKEN_RE.search(cleaned):
        return None
    if not cleaned.strip():
        return None
    return cleaned


def _contains_noncanonical_reserved_tag(text: str) -> bool:
    idx = 0
    while True:
        start = text.find("<", idx)
        if start < 0:
            return False
        end = text.find(">", start + 1)
        if end < 0:
            return False
        inner = text[start + 1 : end]
        parsed = _classify_tag(inner)
        if parsed is not None and parsed[2]:
            return True
        idx = start + 1


def _is_markdown_artifact_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if s.startswith("```") or s.endswith("```"):
        return True
    if s.startswith("#"):
        return True
    if re.match(r"^\|.*\|$", s):
        return True
    if re.match(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", s):
        return True
    return False


def _line_has_reserved_tag_token(line: str) -> bool:
    return bool(_RESERVED_TAG_TOKEN_RE.search(line))


def sanitize_suggested_questions(
    raw: object,
    visible_body: str,
) -> tuple[str, ...]:
    """Validate follow-up chip lines; return exactly three safe lines or empty."""
    if not str(visible_body or "").strip():
        return ()

    candidates: list[str]
    if isinstance(raw, str):
        candidates = raw.splitlines()
    elif isinstance(raw, Sequence) and not isinstance(raw, (bytes, bytearray)):
        candidates = [str(item) for item in raw]
    else:
        return ()

    lines: list[str] = []
    for item in candidates:
        trimmed = strip_model_control_artifacts(str(item).strip())
        if trimmed:
            lines.append(trimmed)

    if len(lines) != 3:
        return ()

    for line in lines:
        if not (1 <= len(line) <= 160):
            return ()
        if _line_has_reserved_tag_token(line):
            return ()
        if _is_markdown_artifact_line(line):
            return ()
    return tuple(lines)


def _normalize_tag_inner(inner: str) -> str:
    # Strip zero-width and collapse whitespace for tag-name recognition.
    cleaned = _ZERO_WIDTH_RE.sub("", inner)
    cleaned = "".join(
        ch for ch in cleaned if unicodedata.category(ch) != "Cf"
    )
    return cleaned.strip()


def _canonical_tag_text(name: str, closing: bool) -> str:
    body = f"/{name}" if closing else name
    return f"<{body}>"


def _classify_tag(inner: str) -> Optional[Tuple[str, bool, bool]]:
    """Return (name, is_closing, noncanonical) or None if not a reserved tag."""
    normalized = _normalize_tag_inner(inner)
    if not normalized:
        return None
    match = _TAG_NAME_RE.match(normalized)
    if not match:
        return None
    name = match.group("name").lower()
    closing = bool(match.group("closing"))
    rest = match.group("rest") or ""
    # Canonical form is exactly ``think`` / ``followups`` with optional trailing
    # spaces only (no attributes). Any extra spacing inside the original ``<>``
    # or attributes marks the tag noncanonical.
    compact_canonical = f"{'/' if closing else ''}{name}"
    original_compact = re.sub(r"\s+", "", _ZERO_WIDTH_RE.sub("", inner)).lower()
    noncanonical = original_compact != compact_canonical or bool(rest.strip())
    # Also treat leading/trailing spaces inside <> as noncanonical.
    if inner != inner.strip() or "\n" in inner or "\r" in inner:
        noncanonical = True
    if _ZERO_WIDTH_RE.search(inner):
        noncanonical = True
    return name, closing, noncanonical


class _ProtocolErrorSet:
    __slots__ = ("_items", "_seen")

    def __init__(self) -> None:
        self._items: list[str] = []
        self._seen: set[str] = set()

    def add(self, code: str) -> None:
        if code not in self._seen and code in _PROTOCOL_ERROR_ORDER:
            self._seen.add(code)
            self._items.append(code)

    def as_tuple(self) -> tuple[str, ...]:
        return tuple(self._items)


class AssistantOutputStreamParser:
    """Incremental tokenizer mirroring :func:`parse_assistant_output`."""

    __slots__ = (
        "_carry",
        "_stack",
        "_body",
        "_reasoning",
        "_followup_buf",
        "_followups_blocks",
        "_followups_invalid",
        "_discard_until",
        "_errors",
        "_safe_stream",
        "_emitted_len",
        "_think_open_emitted",
    )

    def __init__(self) -> None:
        self._carry = ""
        self._stack: list[str] = []
        self._body = ""
        self._reasoning = ""
        self._followup_buf = ""
        self._followups_blocks = 0
        self._followups_invalid = False
        self._discard_until: Optional[str] = None
        self._errors = _ProtocolErrorSet()
        self._safe_stream = ""
        self._emitted_len = 0
        self._think_open_emitted = False

    def feed(self, chunk: str) -> str:
        """Return only the newly safe-to-stream visible/reasoning delta."""
        if not chunk:
            return ""
        self._consume(self._carry + chunk, finalize=False)
        delta = self._safe_stream[self._emitted_len :]
        self._emitted_len = len(self._safe_stream)
        return delta

    def finalize(self) -> ParsedAssistantOutput:
        """Finalize the accumulated turn with the same tokenizer state."""
        if self._carry:
            # Unresolved partial ``<...`` prefix: treat as literal body text.
            self._emit_text(self._carry)
            self._carry = ""
        self._finalize_errors_and_suggestions()
        return self._to_parsed()

    def _consume(self, data: str, *, finalize: bool) -> None:
        i = 0
        n = len(data)
        self._carry = ""
        while i < n:
            ch = data[i]
            if ch != "<":
                self._emit_text(ch)
                i += 1
                continue
            close = data.find(">", i + 1)
            if close < 0:
                # Incomplete tag — hold as carry unless finalizing.
                if not finalize:
                    self._carry = data[i:]
                    return
                self._emit_text(data[i:])
                return
            inner = data[i + 1 : close]
            classified = _classify_tag(inner)
            if classified is None:
                self._emit_text(data[i : close + 1])
                i = close + 1
                continue
            name, is_closing, noncanonical = classified
            if noncanonical:
                self._errors.add("noncanonical_reserved_tag")
            self._handle_tag(name, is_closing)
            i = close + 1

    def _handle_tag(self, name: str, is_closing: bool) -> None:
        if self._discard_until is not None:
            expect = self._discard_until
            if is_closing and name == expect:
                self._discard_until = None
                if name == "followups" and self._stack and self._stack[-1] == "think":
                    # Nested followups closed while think still open.
                    pass
                elif name == "think" and self._stack and self._stack[-1] == "followups":
                    pass
                return
            if not is_closing:
                # Nested opens while discarding stay discarded.
                return
            # Wrong close while discarding: may be mismatched think close.
            if (
                expect == "followups"
                and is_closing
                and name == "think"
                and self._stack
                and self._stack[-1] == "think"
            ):
                self._errors.add("mismatched_close")
                self._close_think_for_stream()
                self._stack.pop()
                # Keep discarding until the nested followups close.
                return
            if (
                expect == "think"
                and is_closing
                and name == "followups"
                and self._stack
                and self._stack[-1] == "followups"
            ):
                self._errors.add("mismatched_close")
                self._stack.pop()
                self._followups_invalid = True
                self._discard_until = None
                return
            return

        if not is_closing:
            self._handle_open(name)
            return
        self._handle_close(name)

    def _handle_open(self, name: str) -> None:
        if self._stack:
            top = self._stack[-1]
            if top != name:
                self._errors.add("nested_reserved_tag")
                if top == "think" and name == "followups":
                    self._followups_invalid = True
                    self._discard_until = "followups"
                    return
                if top == "followups" and name == "think":
                    self._followups_invalid = True
                    self._discard_until = "think"
                    return
            else:
                # Same tag nested — treat as nested error and discard until close.
                self._errors.add("nested_reserved_tag")
                self._discard_until = name
                if name == "followups":
                    self._followups_invalid = True
                return

        if name == "think":
            self._stack.append("think")
            self._safe_stream += "<think>"
            self._think_open_emitted = True
            return

        # followups
        self._stack.append("followups")
        self._followup_buf = ""
        return

    def _handle_close(self, name: str) -> None:
        if not self._stack:
            self._errors.add("stray_close")
            return
        top = self._stack[-1]
        if top != name:
            self._errors.add("mismatched_close")
            # Remove the mismatched unclosed tag so parsing can converge.
            if name in self._stack:
                while self._stack and self._stack[-1] != name:
                    removed = self._stack.pop()
                    if removed == "think":
                        self._close_think_for_stream()
                    elif removed == "followups":
                        self._followups_invalid = True
                if self._stack and self._stack[-1] == name:
                    self._stack.pop()
                    if name == "think":
                        self._close_think_for_stream()
                    elif name == "followups":
                        self._finish_followups_block()
            else:
                # Close for a tag not on stack: stray after mismatch bookkeeping.
                self._errors.add("stray_close")
            return

        self._stack.pop()
        if name == "think":
            self._close_think_for_stream()
            return
        self._finish_followups_block()

    def _close_think_for_stream(self) -> None:
        if self._think_open_emitted:
            self._safe_stream += "</think>"
            self._think_open_emitted = False

    def _finish_followups_block(self) -> None:
        self._followups_blocks += 1
        if self._followups_blocks > 1:
            self._errors.add("multiple_followups")
            self._followups_invalid = True
        # Keep buffer for finalize; invalid/multiple cleared later.

    def _emit_text(self, text: str) -> None:
        if not text:
            return
        if self._discard_until is not None:
            return
        if not self._stack:
            self._body += text
            self._safe_stream += text
            return
        top = self._stack[-1]
        if top == "think":
            self._reasoning += text
            self._safe_stream += text
            return
        if top == "followups":
            self._followup_buf += text
            return

    def _finalize_errors_and_suggestions(self) -> None:
        if self._discard_until == "followups":
            self._errors.add("unclosed_followups")
        elif self._discard_until == "think":
            self._errors.add("unclosed_think")
        for name in list(self._stack):
            if name == "think":
                self._errors.add("unclosed_think")
            elif name == "followups":
                self._errors.add("unclosed_followups")
        self._stack.clear()
        self._close_think_for_stream()

    def _to_parsed(self) -> ParsedAssistantOutput:
        body = self._body
        reasoning = self._reasoning
        errors = self._errors

        suggestions: tuple[str, ...] = ()
        had_followups_attempt = self._followups_blocks > 0 or bool(
            self._followup_buf.strip()
        )

        if self._followups_blocks > 1 or self._followups_invalid:
            suggestions = ()
        elif self._followups_blocks == 1 and "unclosed_followups" not in errors.as_tuple():
            raw_lines = self._followup_buf
            if not body.strip():
                errors.add("missing_visible_body")
                suggestions = ()
            else:
                suggestions = sanitize_suggested_questions(raw_lines, body)
                if not suggestions:
                    # Distinguish count vs line issues for protocol codes.
                    nonempty = [
                        strip_model_control_artifacts(x.strip())
                        for x in raw_lines.splitlines()
                        if strip_model_control_artifacts(x.strip())
                    ]
                    if len(nonempty) != 3:
                        errors.add("invalid_followup_count")
                    else:
                        errors.add("invalid_followup_line")
        elif had_followups_attempt and not body.strip() and self._followups_blocks == 0:
            # Unclosed followups already recorded; no missing_visible_body.
            pass

        if errors.as_tuple():
            # Malformed turns never expose suggestions.
            suggestions = ()

        return ParsedAssistantOutput(
            reasoning=reasoning,
            visible_body=body,
            suggested_questions=suggestions,
            protocol_errors=errors.as_tuple(),
        )


def parse_assistant_output(raw: str) -> ParsedAssistantOutput:
    """Parse a full assistant raw string into canonical protocol fields."""
    parser = AssistantOutputStreamParser()
    parser.feed(str(raw or ""))
    return parser.finalize()
