"""Helpers for Desktop composer context_files key formats.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path

from agenticx.studio.html_element_context import split_el_snippet_context_key

_LINE_RANGE_KEY_RE = re.compile(r"^(?P<path>.+):(?P<start>\d+)-(?P<end>\d+)$")


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


def disk_path_from_context_file_key(key: str) -> str | None:
    """Best-effort absolute disk path for a context_files key.

    Returns None for virtual keys (skill:, @dir:), composer upload dedupe
    keys (name:size:lastModified), and anything that is not an absolute path
    after stripping el-snippet / line-range suffixes.
    Does not check that the file exists.
    """
    text = str(key or "").strip()
    if not text:
        return None
    if text.startswith("skill:") or text.startswith("@dir:"):
        return None
    if is_composer_upload_dedupe_key(text):
        return None
    split = split_el_snippet_context_key(text)
    if split is not None:
        text = split[0]
    lined = _LINE_RANGE_KEY_RE.match(text)
    if lined is not None:
        text = str(lined.group("path") or "").strip()
        if not text:
            return None
    try:
        candidate = Path(text).expanduser()
    except Exception:
        return None
    if not candidate.is_absolute():
        return None
    try:
        return str(candidate.resolve(strict=False))
    except Exception:
        return None
