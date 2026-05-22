#!/usr/bin/env python3
"""progress.md formatter for the human-readable timeline.

Author: Damon Li
"""

from __future__ import annotations

import time

PROGRESS_HEADER = "# Project Progress\n\nAppend-only timeline. Do not edit historical lines.\n\n"


def format_progress_line(message: str) -> str:
    """Prefix ``message`` with an ISO-8601 timestamp marker.

    Lines already containing the marker are returned unchanged so that
    callers can pass pre-formatted strings without double-tagging.
    """
    text = (message or "").strip()
    if not text:
        text = "(empty progress note)"
    if text.startswith("- ["):
        return text + "\n"
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    first_line, _, rest = text.partition("\n")
    if rest:
        body = rest.replace("\n", "\n  ")
        return f"- [{ts}] {first_line}\n  {body}\n"
    return f"- [{ts}] {first_line}\n"


def ensure_progress_header(path) -> None:
    """Write the standard header if the file does not exist yet."""
    from pathlib import Path

    target = Path(path)
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(PROGRESS_HEADER, encoding="utf-8")
