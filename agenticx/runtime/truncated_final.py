"""Model-agnostic detection of truncated-looking terminal replies."""

from __future__ import annotations

import re
from collections.abc import Sequence

_TERMINATOR_RE = re.compile(r"""[。！？.!?)）」』】”’"'`*]$""")
ACTION_INTENT_RE = re.compile(
    r"让我先|我先|接下来要|然后加载|然后调用|去读取|去加载|去搜索|去查|查一下|搜一下|核实|todo_write"
    r"|let me\s+(?:search|check|verify|look|find|do that|try)"
    r"|i\s+(?:need|have)\s+to\s+(?:search|check|verify|look|find)"
    r"|i'?ll\s+(?:search|check|verify|look|find)"
    r"|search\s+the\s+web|verify\s+this|let'?s\s+search",
    re.IGNORECASE,
)

SUSPECT_BODY_MAX_CHARS = 80


def reasoning_has_action_intent(reasoning_text: str) -> bool:
    """Return whether reasoning declares an unfinished external action."""
    return bool(ACTION_INTENT_RE.search(str(reasoning_text or "")))


def detect_suspected_truncated_final(
    *,
    visible_body: str,
    reasoning_text: str,
    had_tool_calls_this_round: bool,
    executed_tool_names: Sequence[str],
    finish_reason: str,
) -> str:
    """Return a signal when a short terminal reply is likely truncated.

    ``finish_reason`` is deliberately accepted for telemetry compatibility but
    not used as a standalone signal: some providers omit it on ordinary,
    complete replies, so treating an absent value as corruption causes false
    continuation requests.
    """
    if had_tool_calls_this_round or executed_tool_names:
        return ""

    body = str(visible_body or "").strip()
    if not body or len(body) > SUSPECT_BODY_MAX_CHARS:
        return ""
    if _TERMINATOR_RE.search(body):
        return ""
    if reasoning_has_action_intent(reasoning_text):
        return "short_unterminated_with_intent"
    return ""
