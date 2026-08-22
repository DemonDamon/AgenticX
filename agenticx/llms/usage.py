"""Provider-neutral normalization for LLM token usage payloads."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .response import TokenUsage


def _field(value: Any, name: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _count(value: Any) -> int:
    if value is None or isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return 0


def _first_count(values: Sequence[Any]) -> int:
    for value in values:
        count = _count(value)
        if count > 0:
            return count
    return 0


def _nested_counts(usage: Any, parents: Sequence[str], child: str) -> list[Any]:
    return [_field(_field(usage, parent), child) for parent in parents]


def _token_usage_from_raw(usage: Any, *, derive_total: bool) -> TokenUsage:
    if usage is None:
        return TokenUsage()

    prompt_tokens = _first_count(
        [_field(usage, "prompt_tokens"), _field(usage, "input_tokens")]
    )
    completion_tokens = _first_count(
        [_field(usage, "completion_tokens"), _field(usage, "output_tokens")]
    )
    total_tokens = _count(_field(usage, "total_tokens"))
    if derive_total and total_tokens == 0 and (prompt_tokens or completion_tokens):
        total_tokens = prompt_tokens + completion_tokens

    # LiteLLM standardizes OpenAI-compatible and Anthropic cache accounting into
    # prompt_tokens_details. The remaining names preserve raw provider payloads
    # found in original_response_usage when that standardized object is absent.
    cached_tokens = _first_count(
        [
            _field(usage, "cached_tokens"),
            *_nested_counts(
                usage,
                ("prompt_tokens_details", "input_tokens_details"),
                "cached_tokens",
            ),
            _field(usage, "cache_read_input_tokens"),
            _field(usage, "prompt_cache_hit_tokens"),
            _field(usage, "cached_prompt_tokens"),
            _field(usage, "_cache_read_input_tokens"),
        ]
    )
    reasoning_tokens = _first_count(
        [
            _field(usage, "reasoning_tokens"),
            *_nested_counts(
                usage,
                ("completion_tokens_details", "output_tokens_details"),
                "reasoning_tokens",
            ),
        ]
    )

    return TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=cached_tokens,
        reasoning_tokens=reasoning_tokens,
    )


def normalize_token_usage(usage: Any) -> TokenUsage:
    """Convert a dict or provider object into AgenticX's canonical usage type."""
    return _token_usage_from_raw(usage, derive_total=True)


def merge_token_usage(*sources: Any) -> TokenUsage:
    """Merge equivalent usage views, letting later views fill missing fields.

    LiteLLM can expose base counts on ``response.usage`` while keeping cache
    details only in ``_hidden_params.original_response_usage``. Sources are
    ordered from most canonical to most raw, so a non-zero canonical value wins.
    """
    usages = [
        _token_usage_from_raw(source, derive_total=False)
        for source in sources
        if source is not None
    ]
    if not usages:
        return TokenUsage()

    def first(attribute: str) -> int:
        return _first_count([getattr(usage, attribute) for usage in usages])

    prompt_tokens = first("prompt_tokens")
    completion_tokens = first("completion_tokens")
    total_tokens = first("total_tokens")
    if total_tokens == 0 and (prompt_tokens or completion_tokens):
        total_tokens = prompt_tokens + completion_tokens
    return TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=first("cached_tokens"),
        reasoning_tokens=first("reasoning_tokens"),
    )


def has_token_usage(usage: TokenUsage) -> bool:
    """Whether at least one meaningful usage count is present."""
    return any(
        getattr(usage, field) > 0
        for field in (
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "cached_tokens",
            "reasoning_tokens",
        )
    )


def token_usage_dict(usage: TokenUsage) -> dict[str, int]:
    """Serialize canonical usage without depending on a Pydantic version."""
    return {
        "prompt_tokens": usage.prompt_tokens,
        "completion_tokens": usage.completion_tokens,
        "total_tokens": usage.total_tokens,
        "cached_tokens": usage.cached_tokens,
        "reasoning_tokens": usage.reasoning_tokens,
    }
