#!/usr/bin/env python3
"""Map LLM response usage fields to DeerFlow-style usage_metadata for SSE.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any


def usage_metadata_from_llm_response(response: Any) -> dict[str, int] | None:
    """Return usage_metadata dict (input/output/total tokens) or None.

    Aligns with DeerFlow frontend expectations (input_tokens, output_tokens, total_tokens).
    Returns None when usage is missing or all counts are zero.
    """
    if response is None:
        return None
    tu = getattr(response, "token_usage", None)
    if tu is not None:
        if hasattr(tu, "prompt_tokens"):
            pt = int(getattr(tu, "prompt_tokens", 0) or 0)
            ct = int(getattr(tu, "completion_tokens", 0) or 0)
            tt = int(getattr(tu, "total_tokens", 0) or 0)
        elif isinstance(tu, dict):
            pt = int(tu.get("prompt_tokens") or 0)
            ct = int(tu.get("completion_tokens") or 0)
            tt = int(tu.get("total_tokens") or 0)
        else:
            return None
        if pt == 0 and ct == 0 and tt == 0:
            return None
        return {
            "input_tokens": pt,
            "output_tokens": ct,
            "total_tokens": tt,
        }
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    if hasattr(usage, "prompt_tokens"):
        pt = int(getattr(usage, "prompt_tokens", 0) or 0)
        ct = int(getattr(usage, "completion_tokens", 0) or 0)
        tt = int(getattr(usage, "total_tokens", 0) or 0)
    elif isinstance(usage, dict):
        pt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        ct = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        tt = int(usage.get("total_tokens") or 0)
    else:
        return None
    if pt == 0 and ct == 0 and tt == 0:
        return None
    return {
        "input_tokens": pt,
        "output_tokens": ct,
        "total_tokens": tt,
    }
