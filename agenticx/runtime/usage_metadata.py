#!/usr/bin/env python3
"""Map LLM response usage fields to DeerFlow-style usage_metadata for SSE.

Supports extended fields used by usage accounting (cached / reasoning tokens).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

# Flat aliases used by OpenAI-compat, Anthropic/LiteLLM, and some CN gateways.
_CACHED_ALIASES = (
    "cached_tokens",
    "cache_read_input_tokens",
    "cached_prompt_tokens",
    "prompt_cache_hit_tokens",
    "cache_read_tokens",
)


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


def _details_cached(details: Any) -> int:
    if details is None:
        return 0
    if isinstance(details, dict):
        return _as_int(details.get("cached_tokens"))
    return _as_int(getattr(details, "cached_tokens", 0))


def _details_reasoning(details: Any) -> int:
    if details is None:
        return 0
    if isinstance(details, dict):
        return _as_int(details.get("reasoning_tokens"))
    return _as_int(getattr(details, "reasoning_tokens", 0))


def extract_cached_reasoning(usage: Any) -> tuple[int, int]:
    """Extract cached_input and reasoning token counts from provider usage payload."""
    if usage is None:
        return 0, 0
    cached = 0
    if isinstance(usage, dict):
        for key in _CACHED_ALIASES:
            cached = _as_int(usage.get(key))
            if cached:
                break
        if cached == 0:
            cached = _details_cached(usage.get("prompt_tokens_details"))
        if cached == 0:
            cached = _details_cached(usage.get("input_tokens_details"))
        reasoning = _details_reasoning(usage.get("completion_tokens_details"))
        return cached, reasoning
    for attr in _CACHED_ALIASES:
        cached = _as_int(getattr(usage, attr, 0))
        if cached:
            break
    if cached == 0:
        cached = _details_cached(getattr(usage, "prompt_tokens_details", None))
    if cached == 0:
        cached = _details_cached(getattr(usage, "input_tokens_details", None))
    reasoning = _details_reasoning(getattr(usage, "completion_tokens_details", None))
    return cached, reasoning


def normalize_stream_usage(usage: Any) -> dict[str, int] | None:
    """Flatten a streamed usage payload into ledger fields.

    Desktop chat is streaming. Providers used to yield only prompt/completion/total
    and drop cached/reasoning, so ``usage.sqlite`` stayed at 0 hits for every vendor.
    """
    if usage is None:
        return None
    if isinstance(usage, dict):
        pt = _as_int(usage.get("prompt_tokens") or usage.get("input_tokens"))
        ct = _as_int(usage.get("completion_tokens") or usage.get("output_tokens"))
        tt = _as_int(usage.get("total_tokens"))
    else:
        pt = _as_int(getattr(usage, "prompt_tokens", 0) or getattr(usage, "input_tokens", 0))
        ct = _as_int(getattr(usage, "completion_tokens", 0) or getattr(usage, "output_tokens", 0))
        tt = _as_int(getattr(usage, "total_tokens", 0))
    cached, reasoning = extract_cached_reasoning(usage)
    if tt == 0 and (pt > 0 or ct > 0):
        tt = pt + ct
    if pt == 0 and ct == 0 and tt == 0 and cached == 0 and reasoning == 0:
        return None
    return {
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "total_tokens": tt,
        "cached_tokens": cached,
        "reasoning_tokens": reasoning,
    }


def _extract_cached_reasoning_from_usage(usage: Any) -> tuple[int, int]:
    """Private alias kept for existing callers and tests."""
    return extract_cached_reasoning(usage)


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
            cached, reasoning = extract_cached_reasoning(tu)
        elif isinstance(tu, dict):
            pt = int(tu.get("prompt_tokens") or tu.get("input_tokens") or 0)
            ct = int(tu.get("completion_tokens") or tu.get("output_tokens") or 0)
            tt = int(tu.get("total_tokens") or 0)
            cached, reasoning = extract_cached_reasoning(tu)
        else:
            return None
        if cached == 0 or reasoning == 0:
            extra_c, extra_r = extract_cached_reasoning(getattr(response, "usage", None))
            if cached == 0:
                cached = extra_c
            if reasoning == 0:
                reasoning = extra_r
        if cached == 0 or reasoning == 0:
            meta = getattr(response, "metadata", None)
            raw = None
            if isinstance(meta, dict):
                raw = meta.get("usage") or meta.get("raw_usage")
            extra_c, extra_r = extract_cached_reasoning(raw)
            if cached == 0:
                cached = extra_c
            if reasoning == 0:
                reasoning = extra_r
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


_USAGE_KEYS = (
    "input_tokens",
    "output_tokens",
    "cached_tokens",
    "reasoning_tokens",
    "total_tokens",
)


def empty_usage_dict() -> dict[str, int]:
    """Return a zeroed usage dict for one chat turn."""
    return {key: 0 for key in _USAGE_KEYS}


def add_usage_dicts(
    acc: dict[str, int] | None,
    delta: dict[str, int] | None,
) -> dict[str, int]:
    """Sum two usage dicts; backfill total_tokens from input+output when needed."""
    out = empty_usage_dict()
    for src in (acc, delta):
        if not src:
            continue
        for key in _USAGE_KEYS:
            out[key] += max(0, int(src.get(key, 0) or 0))
    if out["total_tokens"] == 0 and (out["input_tokens"] or out["output_tokens"]):
        out["total_tokens"] = out["input_tokens"] + out["output_tokens"]
    return out


def usage_dict_has_counts(usage: dict[str, int] | None) -> bool:
    """True when any ledger field is a positive count."""
    if not usage:
        return False
    return any(int(usage.get(key, 0) or 0) > 0 for key in _USAGE_KEYS)
