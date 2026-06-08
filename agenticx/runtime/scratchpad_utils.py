#!/usr/bin/env python3
"""Scratchpad value normalization helpers.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

SESSION_META_UNATTENDED = "unattended_enabled"

SCRATCHPAD_BOOL_KEYS: frozenset[str] = frozenset(
    {
        SESSION_META_UNATTENDED,
    }
)


def scratchpad_truthy(value: Any) -> bool:
    """Accept True / 1 / \"1\" / \"true\" (case-insensitive) as enabled."""
    if value is True:
        return True
    if value is False or value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "on"}


def normalize_scratchpad_loaded(data: dict[str, Any]) -> dict[str, Any]:
    """Coerce known boolean scratchpad keys after SQLite load."""
    out: dict[str, Any] = dict(data)
    for key in SCRATCHPAD_BOOL_KEYS:
        if key in out:
            out[key] = scratchpad_truthy(out[key])
    return out
