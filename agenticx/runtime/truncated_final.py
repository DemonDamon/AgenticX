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

SEARCH_DEFER_STUB_MAX_CHARS = 220

_SEARCH_DEFER_STUB_RE = re.compile(
    r"(?:我先|让我先|我来|让我).{0,16}(?:联网|上网|搜索|检索|查证|查一下|搜一下|核实)"
    r"|先(?:去)?(?:联网|上网).{0,8}(?:查|搜)"
    r"|联网查证|上网[查搜]"
    r"|(?:need to|have to|i'?ll|let me).{0,28}(?:search|look\s*up|verify|check).{0,16}(?:web|online)?"
    r"|search\s+the\s+web",
    re.IGNORECASE,
)

_SEARCH_DEFER_ALREADY_DONE_RE = re.compile(r"(?:查|搜)了|(?:查|搜)到了?|结论是|厂商是")


def is_search_deferral_stub(*, visible_body: str, reasoning_text: str = "") -> bool:
    """True when the model only promised a lookup and did not start answering."""
    body = str(visible_body or "").strip()
    if not body or len(body) >= SEARCH_DEFER_STUB_MAX_CHARS:
        return False
    if _SEARCH_DEFER_ALREADY_DONE_RE.search(body):
        return False
    if _SEARCH_DEFER_STUB_RE.search(body):
        return True
    reasoning = str(reasoning_text or "").strip()
    if reasoning and _SEARCH_DEFER_STUB_RE.search(reasoning):
        return bool(re.search(r"我先|让我先|稍等|正在|马上|避免凭印象", body))
    return False


# Explicit vendor "hit max tokens" reasons — always continue once.
_LENGTH_FINISH_REASONS = frozenset(
    {
        "length",
        "max_tokens",
        "max_output_tokens",
        "max_completion_tokens",
    }
)


def is_length_finish_reason(finish_reason: str) -> bool:
    """True when the vendor stopped because the completion cap was hit."""
    return str(finish_reason or "").strip().lower() in _LENGTH_FINISH_REASONS

SUSPECT_BODY_MAX_CHARS = 80

# Vendors always close a healthy stream with a finish_reason. An empty one means
# the SSE ended without a closing chunk — for litellm a mid-stream disconnect is
# a clean EOF, so nothing raises and the half-written reply looks final.
_MISSING_FINISH_REASONS = frozenset({"", "unknown", "none", "null"})

# Ending on a continuation mark means the sentence was still going. Paired with
# a missing finish_reason this is an aborted stream, not a terse answer; a
# missing finish_reason alone is deliberately not enough (see tests).
_CONTINUATION_END_RE = re.compile(r"[，,、；;：:]$")

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
    2. Missing finish_reason + body left on a continuation mark (aborted stream).
    3. Unbalanced markdown fences / bold markers (any body length, no tools).
    4. Legacy short-body + action-intent heuristic (≤80 chars).
    """
    normalized_finish = str(finish_reason or "").strip().lower()
    if normalized_finish in _LENGTH_FINISH_REASONS:
        return "finish_reason_length"

    if had_tool_calls_this_round or executed_tool_names:
        return ""

    body = str(visible_body or "").strip()
    if not body:
        return ""

    if (
        normalized_finish in _MISSING_FINISH_REASONS
        and _CONTINUATION_END_RE.search(body)
    ):
        return "aborted_stream_no_finish_reason"

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
    if ACTION_INTENT_RE.search(str(reasoning_text or "")):
        return "short_unterminated_with_intent"
    return ""
