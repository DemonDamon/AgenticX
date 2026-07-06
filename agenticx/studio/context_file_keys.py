"""Helpers for Desktop composer context_files key formats.

Author: Damon Li
"""

from __future__ import annotations


def is_composer_upload_dedupe_key(key: str) -> bool:
    """True when key matches Desktop drag/paste dedupe: ``name:size:lastModified``."""
    text = str(key or "").strip()
    if not text:
        return False
    parts = text.split(":")
    if len(parts) < 3:
        return False
    if not parts[-1].isdigit() or not parts[-2].isdigit():
        return False
    try:
        size_val = int(parts[-2])
        ts_val = int(parts[-1])
    except ValueError:
        return False
    # lastModified ms (2001+) — distinct from workspace line ranges.
    return ts_val >= 1_000_000_000_000 and size_val >= 0


def strip_composer_upload_dedupe_key(key: str) -> str:
    """Return display filename portion from an upload dedupe key."""
    text = str(key or "").strip()
    if not is_composer_upload_dedupe_key(text):
        return text
    base = ":".join(text.split(":")[:-2]).strip()
    return base or text


def upload_dedupe_size_from_key(key: str) -> int | None:
    """Extract declared byte size from upload dedupe key, if present."""
    text = str(key or "").strip()
    if not is_composer_upload_dedupe_key(text):
        return None
    try:
        return int(text.split(":")[-2])
    except (IndexError, ValueError):
        return None
