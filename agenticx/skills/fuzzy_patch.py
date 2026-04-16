#!/usr/bin/env python3
"""Fuzzy find-and-replace for skill patch operations.

Implements a 5-strategy matching chain (inspired by Hermes ``tools/fuzzy_match.py``,
MIT license, Nous Research) to handle whitespace / indentation differences
common in LLM-generated patch strings.

Strategies (tried in order):
  1. exact — direct string comparison
  2. line_trimmed — strip leading/trailing whitespace per line
  3. whitespace_normalized — collapse runs of spaces/tabs to single space
  4. indentation_flexible — ignore all leading whitespace
  5. escape_normalized — convert ``\\n`` literals to actual newlines

Upstream reference: hermes-agent ``tools/fuzzy_match.py`` (MIT, Nous Research).

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Callable


def fuzzy_find_and_replace(
    content: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
) -> tuple[str, int, str | None, str | None]:
    """Find and replace using a chain of increasingly fuzzy strategies.

    Returns:
        ``(new_content, match_count, strategy_name, error_message)``
        On success error_message is ``None``; on failure match_count is 0.
    """
    if not old_string:
        return content, 0, None, "old_string cannot be empty"
    if old_string == new_string:
        return content, 0, None, "old_string and new_string are identical"

    strategies: list[tuple[str, Callable[[str, str], list[tuple[int, int]]]]] = [
        ("exact", _strategy_exact),
        ("line_trimmed", _strategy_line_trimmed),
        ("whitespace_normalized", _strategy_whitespace_normalized),
        ("indentation_flexible", _strategy_indentation_flexible),
        ("escape_normalized", _strategy_escape_normalized),
    ]

    for name, fn in strategies:
        matches = fn(content, old_string)
        if matches:
            if len(matches) > 1 and not replace_all:
                return content, 0, None, (
                    f"Found {len(matches)} matches (strategy: {name}). "
                    "Provide more context to make it unique, or set replace_all=True."
                )
            new_content = _apply_replacements(content, matches, new_string)
            return new_content, len(matches), name, None

    return content, 0, None, "Could not find a match for old_string in the file"


def _apply_replacements(content: str, matches: list[tuple[int, int]], new_string: str) -> str:
    """Apply replacements at given (start, end) positions, back to front."""
    result = content
    for start, end in sorted(matches, key=lambda x: x[0], reverse=True):
        result = result[:start] + new_string + result[end:]
    return result


def _strategy_exact(content: str, pattern: str) -> list[tuple[int, int]]:
    matches: list[tuple[int, int]] = []
    start = 0
    while True:
        pos = content.find(pattern, start)
        if pos == -1:
            break
        matches.append((pos, pos + len(pattern)))
        start = pos + 1
    return matches


def _strategy_line_trimmed(content: str, pattern: str) -> list[tuple[int, int]]:
    """Match with per-line whitespace trimming."""
    pattern_lines = [l.strip() for l in pattern.split("\n")]
    pattern_norm = "\n".join(pattern_lines)
    content_lines = content.split("\n")
    content_norm_lines = [l.strip() for l in content_lines]
    return _find_line_block_matches(content, content_lines, content_norm_lines, pattern_norm)


def _strategy_whitespace_normalized(content: str, pattern: str) -> list[tuple[int, int]]:
    """Collapse multiple spaces/tabs to single space."""
    def norm(s: str) -> str:
        return re.sub(r"[ \t]+", " ", s)

    pattern_norm = norm(pattern)
    content_norm = norm(content)
    matches_in_norm = _strategy_exact(content_norm, pattern_norm)
    if not matches_in_norm:
        return []
    return _map_normalized_positions(content, content_norm, matches_in_norm)


def _strategy_indentation_flexible(content: str, pattern: str) -> list[tuple[int, int]]:
    """Strip all leading whitespace before matching."""
    pattern_lines = [l.lstrip() for l in pattern.split("\n")]
    content_lines = content.split("\n")
    content_stripped = [l.lstrip() for l in content_lines]
    return _find_line_block_matches(content, content_lines, content_stripped, "\n".join(pattern_lines))


def _strategy_escape_normalized(content: str, pattern: str) -> list[tuple[int, int]]:
    """Convert ``\\n`` / ``\\t`` literals to actual characters."""
    unescaped = pattern.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
    if unescaped == pattern:
        return []
    return _strategy_exact(content, unescaped)


def _find_line_block_matches(
    original: str,
    orig_lines: list[str],
    norm_lines: list[str],
    pattern_norm: str,
) -> list[tuple[int, int]]:
    """Slide a window of pattern-height over normalised lines, return original spans."""
    pat_lines = pattern_norm.split("\n")
    n_pat = len(pat_lines)
    matches: list[tuple[int, int]] = []
    for i in range(len(norm_lines) - n_pat + 1):
        window = "\n".join(norm_lines[i : i + n_pat])
        if window == pattern_norm:
            start = sum(len(orig_lines[j]) + 1 for j in range(i))
            end = sum(len(orig_lines[j]) + 1 for j in range(i + n_pat))
            if end > 0:
                end -= 1
            if end > len(original):
                end = len(original)
            matches.append((start, end))
    return matches


def _map_normalized_positions(
    original: str,
    normalized: str,
    norm_matches: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Map positions from a normalized string back to the original.

    Works by building a character-index mapping from original → normalized.
    """
    orig_to_norm: list[int] = []
    norm_idx = 0
    i = 0
    while i < len(original):
        orig_to_norm.append(norm_idx)
        if norm_idx < len(normalized) and original[i] == normalized[norm_idx]:
            norm_idx += 1
        elif original[i] in " \t":
            pass
        else:
            norm_idx += 1
        i += 1
    orig_to_norm.append(norm_idx)

    result: list[tuple[int, int]] = []
    for ns, ne in norm_matches:
        os_found = None
        oe_found = None
        for oi, ni in enumerate(orig_to_norm):
            if ni >= ns and os_found is None:
                os_found = oi
            if ni >= ne and oe_found is None:
                oe_found = oi
                break
        if os_found is not None:
            if oe_found is None:
                oe_found = len(original)
            result.append((os_found, oe_found))
    return result
