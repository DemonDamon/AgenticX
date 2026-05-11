#!/usr/bin/env python3
"""Map LLM response usage fields to DeerFlow-style usage_metadata for SSE.

Supports extended fields used by usage accounting (cached / reasoning tokens).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any


def _extract_cached_reasoning_from_usage(usage: Any) -> tuple[int, int]:
    """Extract cached_input and reasoning token counts from provider usage payload."""
    cached = 0
    reasoning = 0
    if usage is None:
        return 0, 0
    if isinstance(usage, dict):
        ptd = usage.get("prompt_tokens_details")
        if isinstance(ptd, dict):
            cached = int(ptd.get("cached_tokens") or 0)
        ctd = usage.get("completion_tokens_details")
        if isinstance(ctd, dict):
            reasoning = int(ctd.get("reasoning_tokens") or 0)
        if cached == 0:
            for key in ("cache_read_input_tokens", "cached_prompt_tokens"):
                v = usage.get(key)
                if v is not None:
                    cached = int(v or 0)
                    break
        return max(0, cached), max(0, reasoning)
    ptd = getattr(usage, "prompt_tokens_details", None)
    if ptd is not None:
        cached = int(getattr(ptd, "cached_tokens", 0) or 0)
    ctd = getattr(usage, "completion_tokens_details", None)
    if ctd is not None:
        reasoning = int(getattr(ctd, "reasoning_tokens", 0) or 0)
    if cached == 0:
        for attr in ("cache_read_input_tokens", "cached_prompt_tokens"):
            if hasattr(usage, attr):
                cached = int(getattr(usage, attr, 0) or 0)
                break
    return max(0, cached), max(0, reasoning)


def usage_metadata_from_llm_response(response: Any) -> dict[str, int] | None:
    """Return usage_metadata dict or None.

    Keys: input_tokens, output_tokens, total_tokens, cached_tokens, reasoning_tokens.
    Aligns with DeerFlow frontend expectations for input/output/total.
    Returns None when usage is missing or all meaningful counts are zero.
    """
    if response is None:
        return None
    tu = getattr(response, "token_usage", None)
    if tu is not None:
        if hasattr(tu, "prompt_tokens"):
            pt = int(getattr(tu, "prompt_tokens", 0) or 0)
            ct = int(getattr(tu, "completion_tokens", 0) or 0)
            tt = int(getattr(tu, "total_tokens", 0) or 0)
            cached, reasoning = _extract_cached_reasoning_from_usage(tu)
        elif isinstance(tu, dict):
            pt = int(tu.get("prompt_tokens") or tu.get("input_tokens") or 0)
            ct = int(tu.get("completion_tokens") or tu.get("output_tokens") or 0)
            tt = int(tu.get("total_tokens") or 0)
            cached, reasoning = _extract_cached_reasoning_from_usage(tu)
        else:
            return None
        if tt == 0 and (pt > 0 or ct > 0):
            tt = pt + ct
        if pt == 0 and ct == 0 and tt == 0 and cached == 0 and reasoning == 0:
            return None
        return {
            "input_tokens": pt,
            "output_tokens": ct,
            "total_tokens": tt,
            "cached_tokens": cached,
            "reasoning_tokens": reasoning,
        }
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    if hasattr(usage, "prompt_tokens"):
        pt = int(getattr(usage, "prompt_tokens", 0) or 0)
        ct = int(getattr(usage, "completion_tokens", 0) or 0)
        tt = int(getattr(usage, "total_tokens", 0) or 0)
        cached, reasoning = _extract_cached_reasoning_from_usage(usage)
    elif isinstance(usage, dict):
        pt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        ct = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        tt = int(usage.get("total_tokens") or 0)
        cached, reasoning = _extract_cached_reasoning_from_usage(usage)
    else:
        return None
    if pt == 0 and ct == 0 and tt == 0 and cached == 0 and reasoning == 0:
        return None
    if tt == 0 and (pt > 0 or ct > 0):
        tt = pt + ct
    return {
        "input_tokens": pt,
        "output_tokens": ct,
        "total_tokens": tt,
        "cached_tokens": cached,
        "reasoning_tokens": reasoning,
    }
