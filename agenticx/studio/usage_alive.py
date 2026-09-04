#!/usr/bin/env python3
"""Helpers for session-usage windows after retry / edit truncate.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any


def as_timestamp_ms(raw: Any) -> int:
    """Normalize a message timestamp to milliseconds. Unknown values are 0."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 0
    if value <= 0:
        return 0
    # 10-digit unix seconds → ms. Tiny fixture timestamps stay as-is.
    if 1_000_000_000 <= value < 1_000_000_000_000:
        return value * 1000
    return value


def keep_before_ms_from_messages(rows: list[Any] | None) -> int:
    """Latest timestamp among remaining rows after a retry/edit cut.

    Events after this instant belong to discarded generations of the
    truncated turn (and later turns). Events at or before it belong to
    surviving history.
    """
    best = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        ts = as_timestamp_ms(row.get("timestamp"))
        if ts > best:
            best = ts
    return best
