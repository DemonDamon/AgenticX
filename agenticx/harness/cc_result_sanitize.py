#!/usr/bin/env python3
"""Sanitize Claude Code harness ``result`` text before Near posts it.

GLM-via-gateway (and similar) sometimes dumps English chain-of-thought /
identity drafts into the NDJSON ``type=result`` ``result`` field, including
raw think-close markers. The CC adapter previously forwarded that string
almost verbatim into the Near assistant message.

This module is the single choke point for that path. Builtin / python-agent
keep using :func:`agenticx.runtime.assistant_output.parse_assistant_output`
on their own stream; they do not import this helper.

Author: Damon Li
"""

from __future__ import annotations

import re

from agenticx.runtime.assistant_output import parse_assistant_output

# Closing tags that end a leaked thinking / redacted-thinking block.
_THINK_CLOSE_RE = re.compile(
    r"</\s*(?:redacted[_-])?think(?:ing)?\s*>",
    re.IGNORECASE,
)
# Open tags left behind after a "keep after last close" cut, or unpaired.
_THINK_OPEN_RE = re.compile(
    r"<\s*(?:redacted[_-])?think(?:ing)?\b[^>]*>",
    re.IGNORECASE,
)

# Meta-instruction the model writes while drafting the real reply.
# Match mid-string too: session leaks put the directive after English prose
# on the same line (e.g. "User asks … Answer briefly: <body>").
_ANSWER_DIRECTIVE_RE = re.compile(
    r"(?is)\bAnswer\s+(?:briefly|simply)\s*:\s*"
)


def sanitize_claude_code_result_text(raw: str) -> str:
    """Return user-facing assistant text from a CC NDJSON ``result`` payload.

    Policy (conservative):
    1. If any closing think / redacted-thinking tag appears, drop everything
       through the **last** such tag (preamble + thinking stay out).
    2. Strip any remaining think open/close wrappers; then run the canonical
       assistant-output parser so paired ``<think>`` blocks are handled the
       same way as the builtin path.
    3. When an English ``Answer briefly:`` / ``Answer simply:`` directive
       remains, keep only the body after the last such marker (clear
       planning preamble before the real answer). Do not invent broader
       English-prose heuristics.
    """
    text = str(raw or "")
    if not text.strip():
        return ""

    closes = list(_THINK_CLOSE_RE.finditer(text))
    if closes:
        text = text[closes[-1].end() :]

    text = _THINK_OPEN_RE.sub("", text)
    text = _THINK_CLOSE_RE.sub("", text)
    text = parse_assistant_output(text).visible_body

    text = _strip_answer_directive_preamble(text)
    return text.strip()


def _strip_answer_directive_preamble(text: str) -> str:
    matches = list(_ANSWER_DIRECTIVE_RE.finditer(text))
    if not matches:
        return text
    after = text[matches[-1].end() :]
    if after.strip():
        return after
    return text


__all__ = ["sanitize_claude_code_result_text"]
