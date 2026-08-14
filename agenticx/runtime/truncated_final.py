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

# Explicit vendor "hit max tokens" reasons — always continue once.
_LENGTH_FINISH_REASONS = frozenset(
    {
        "length",
        "max_tokens",
        "max_output_tokens",
        "max_completion_tokens",
    }
)

SUSPECT_BODY_MAX_CHARS = 80

def reasoning_has_action_intent(reasoning_text: str) -> bool:
    """Return whether reasoning declares an unfinished external action."""
    return bool(ACTION_INTENT_RE.search(str(reasoning_text or "")))


# Ends mid-token after a path separator, e.g. "补 T4/T" cut before "T5".
_MID_PATH_CUT_RE = re.compile(r"[A-Za-z0-9_\u4e00-\u9fff]/[A-Za-z0-9_\u4e00-\u9fff]{0,3}$")


def _has_unbalanced_markdown(body: str) -> bool:
    """True when common markdown delimiters are left open (strong cut signal)."""
    text = str(body or "")
    if text.count("```") % 2 == 1:
        return True
    # Bold/italic markers: odd ** count means an unclosed span (this session's
    # architect reply ended mid-`**一句话…`).
    if text.count("**") % 2 == 1:
        return True
    return False


def detect_suspected_truncated_final(
    *,
    visible_body: str,
    reasoning_text: str,
    had_tool_calls_this_round: bool,
    executed_tool_names: Sequence[str],
    finish_reason: str,
) -> str:
    """Return a signal when a terminal reply is likely truncated.

    Priority:
    1. Explicit length / max_tokens finish reasons (any body length).
    2. Unbalanced markdown fences / bold markers (any body length, no tools).
    3. Legacy short-body + action-intent heuristic (≤80 chars).
    """
    normalized_finish = str(finish_reason or "").strip().lower()
    if normalized_finish in _LENGTH_FINISH_REASONS:
        return "finish_reason_length"

    if had_tool_calls_this_round or executed_tool_names:
        return ""

    body = str(visible_body or "").strip()
    if not body:
        return ""

    if _has_unbalanced_markdown(body):
        return "unbalanced_markdown"

    last_line = next(
        (ln.strip() for ln in reversed(body.splitlines()) if ln.strip()),
        "",
    )
    if (
        last_line
        and not _TERMINATOR_RE.search(last_line)
        and _MID_PATH_CUT_RE.search(last_line)
        and len(body) > SUSPECT_BODY_MAX_CHARS
    ):
        return "mid_path_cut"

    if len(body) > SUSPECT_BODY_MAX_CHARS:
        return ""
    if _TERMINATOR_RE.search(body):
        return ""
    if reasoning_has_action_intent(reasoning_text):
        return "short_unterminated_with_intent"
    return ""
