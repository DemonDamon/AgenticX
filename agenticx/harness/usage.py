#!/usr/bin/env python3
"""Normalize external-harness turn usage into Near ``token_usage`` SSE shape.

ChatPane ``parseMessageUsage`` accepts ``input_tokens`` / ``output_tokens`` /
``cached_tokens`` / ``total_tokens`` (and camelCase aliases). Builtin runtime
emits the same keys via ``usage_metadata`` on FINAL then a ``token_usage``
event. Harness turns previously skipped that path.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional


def _as_int(value: Any) -> int:
    if value is None or isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return 0
        try:
            return max(0, int(raw))
        except ValueError:
            try:
                return max(0, int(float(raw)))
            except ValueError:
                return 0
    return 0


def usage_metadata_from_claude_result_usage(
    usage: Mapping[str, Any] | None,
) -> Optional[Dict[str, int]]:
    """Map Claude Code ``result.usage`` object to Near usage_metadata keys."""
    if not isinstance(usage, Mapping):
        return None
    input_tokens = _as_int(usage.get("input_tokens") or usage.get("inputTokens"))
    output_tokens = _as_int(usage.get("output_tokens") or usage.get("outputTokens"))
    cached = _as_int(
        usage.get("cache_read_input_tokens")
        or usage.get("cached_tokens")
        or usage.get("cacheReadInputTokens")
        or usage.get("cachedTokens")
    )
    total = _as_int(usage.get("total_tokens") or usage.get("totalTokens"))
    if total <= 0:
        total = input_tokens + output_tokens
    if input_tokens <= 0 and output_tokens <= 0 and total <= 0 and cached <= 0:
        return None
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_tokens": cached,
        "reasoning_tokens": 0,
        "total_tokens": total,
    }


def usage_metadata_from_harness_detail(
    detail: Mapping[str, Any] | None,
) -> Optional[Dict[str, int]]:
    """Pull usage_metadata from a :class:`TurnResult`.detail dict.

    Recognized shapes:
    - ``usage_metadata`` already normalized
    - ``usage`` Claude Code result.usage
    - ``usage_totals`` CodeBuddy / WorkBuddy totals (input/output/cached)
    """
    if not isinstance(detail, Mapping):
        return None
    existing = detail.get("usage_metadata")
    if isinstance(existing, Mapping):
        normalized = usage_metadata_from_claude_result_usage(existing)
        if normalized is not None:
            return normalized
    usage = detail.get("usage")
    if isinstance(usage, Mapping):
        normalized = usage_metadata_from_claude_result_usage(usage)
        if normalized is not None:
            return normalized
    totals = detail.get("usage_totals")
    if isinstance(totals, Mapping):
        # WB may use input/output/cached or *_tokens
        mapped = {
            "input_tokens": _as_int(
                totals.get("input_tokens")
                or totals.get("input")
                or totals.get("prompt_tokens")
            ),
            "output_tokens": _as_int(
                totals.get("output_tokens")
                or totals.get("output")
                or totals.get("completion_tokens")
            ),
            "cached_tokens": _as_int(
                totals.get("cached_tokens")
                or totals.get("cached")
                or totals.get("cache_read_input_tokens")
            ),
            "total_tokens": _as_int(totals.get("total_tokens") or totals.get("total")),
        }
        return usage_metadata_from_claude_result_usage(mapped)
    return None


__all__ = [
    "usage_metadata_from_claude_result_usage",
    "usage_metadata_from_harness_detail",
]
