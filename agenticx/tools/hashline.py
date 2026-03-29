#!/usr/bin/env python3
"""Hashline utilities for line-stable editing references.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
from typing import Optional

_HASHLINE_DICT = "ZPMQVRWSNKTXJBYHABCDEFGHIJLOU0123456789"


def _has_alphanum(text: str) -> bool:
    return any(char.isalnum() for char in text)


def _map_char(index: int) -> str:
    return _HASHLINE_DICT[index % len(_HASHLINE_DICT)]


def compute_line_hash(line_number: int, content: str) -> str:
    """Compute a two-character hash tag for one line."""
    normalized = content.rstrip("\r").rstrip()
    if _has_alphanum(normalized):
        payload = normalized.encode("utf-8")
    else:
        payload = f"{line_number}:{normalized}".encode("utf-8")
    digest = hashlib.md5(payload).digest()  # noqa: S324 - non-crypto checksum by design
    return f"{_map_char(digest[0])}{_map_char(digest[1])}"


def format_hashline(line_number: int, content: str) -> str:
    """Format one line with hashline prefix."""
    return f"{line_number}#{compute_line_hash(line_number, content)}|{content}"


def inject_hashlines(file_content: str) -> str:
    """Inject hashline prefixes for every line in content."""
    lines = file_content.split("\n")
    return "\n".join(format_hashline(index + 1, line) for index, line in enumerate(lines))


def validate_line_ref(lines: list[str], line_ref: str) -> Optional[str]:
    """Validate a line reference in '<line>#<tag>' format."""
    parts = line_ref.split("#", 1)
    if len(parts) != 2:
        return f"Invalid ref format: {line_ref}"
    raw_line, expected_tag = parts
    try:
        line_number = int(raw_line)
    except ValueError:
        return f"Invalid line number: {raw_line}"
    if line_number < 1 or line_number > len(lines):
        return f"Line {line_number} out of bounds (file has {len(lines)} lines)"
    actual_tag = compute_line_hash(line_number, lines[line_number - 1])
    if actual_tag == expected_tag:
        return None
    current = format_hashline(line_number, lines[line_number - 1])
    return (
        f"Hash mismatch at line {line_number}: expected #{expected_tag}, "
        f"actual #{actual_tag}. Current: {current}"
    )
