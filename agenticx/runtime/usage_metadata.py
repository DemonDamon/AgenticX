#!/usr/bin/env python3
"""Map LLM response usage fields to DeerFlow-style usage_metadata for SSE.

Supports extended fields used by usage accounting (cached / reasoning tokens).

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from agenticx.llms.usage import has_token_usage, merge_token_usage


def _response_field(response: Any, name: str) -> Any:
    if isinstance(response, Mapping):
        return response.get(name)
    return getattr(response, name, None)


def usage_metadata_from_llm_response(response: Any) -> dict[str, int] | None:
    """Return usage_metadata dict or None.

    Keys: input_tokens, output_tokens, total_tokens, cached_tokens, reasoning_tokens.
    Aligns with DeerFlow frontend expectations for input/output/total.
    Returns None when usage is missing or all meaningful counts are zero.
    """
    if response is None:
        return None
    usage = merge_token_usage(
        _response_field(response, "token_usage"),
        _response_field(response, "usage"),
    )
    if not has_token_usage(usage):
        return None
    return {
        "input_tokens": usage.prompt_tokens,
        "output_tokens": usage.completion_tokens,
        "total_tokens": usage.total_tokens,
        "cached_tokens": usage.cached_tokens,
        "reasoning_tokens": usage.reasoning_tokens,
    }
