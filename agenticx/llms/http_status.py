"""Extract HTTP failure evidence without treating request metadata as status.

This module is shared by fault reporting and retry policy. It has no SDK or
Studio dependencies.
"""

from __future__ import annotations

import re
from collections import deque
from typing import Iterator, Optional

_URL = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_STATUS = re.compile(
    r"(?:\b(?:http(?:/\d(?:\.\d)?)?(?:\s+status)?|status(?:[_\s-]*code)?|"
    r"error(?:\s+code)?|response(?:\s+code)?|code)\b[\"']?\s*[:=]?\s*|^\s*)"
    r"([1-5][0-9]{2})(?![\w])",
    re.IGNORECASE | re.MULTILINE,
)


def exception_chain(exc: BaseException) -> Iterator[BaseException]:
    """Walk live causes and SDK wrappers once, with a bounded traversal."""
    pending = deque([exc])
    seen: set[int] = set()
    while pending and len(seen) < 64:
        current = pending.popleft()
        if id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        cause = current.__cause__
        nested = (getattr(current, "original_exception", None), cause)
        if cause is None and not current.__suppress_context__:
            nested += (current.__context__,)
        pending.extend(item for item in nested if isinstance(item, BaseException))


def exception_text(exc: BaseException) -> str:
    """Return only live-chain messages, excluding URL metadata."""
    return "\n".join(
        f"{type(item).__name__} {_URL.sub('', str(item))}"
        for item in exception_chain(exc)
    )


def _status_value(value: object) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 100 <= value < 600 else None
    if isinstance(value, str) and re.fullmatch(r"[1-5][0-9]{2}", value):
        return int(value)
    return None


def http_status_code(exc: BaseException) -> Optional[int]:
    """Prefer structured status anywhere in the live chain over message text."""
    chain = list(exception_chain(exc))
    for item in chain:
        for source in (item, getattr(item, "response", None)):
            value = _status_value(getattr(source, "status_code", None))
            if value is not None:
                return value
    for item in chain:
        match = _STATUS.search(_URL.sub("", str(item)))
        if match:
            return int(match.group(1))
    return None
