#!/usr/bin/env python3
"""Model context window lookup shared by ToolSearch and context usage.

Author: Damon Li
"""

MODEL_CONTEXT_WINDOWS: list[tuple[str, int]] = [
    ("claude-opus-4", 200_000),
    ("claude-sonnet-5", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude", 200_000),
    ("gpt-5", 256_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 128_000),
    ("o1", 200_000),
    ("o3", 200_000),
    # V4 全系（Pro / Flash）都是 1M。0731 那版实际是 1,310,720，但这里按 1M 记：
    # 猜低只是提前压缩，猜高会让 autocompact 触发太晚、被上游直接拒。
    ("deepseek-v4", 1_048_576),
    ("deepseek", 128_000),
    ("qwen", 128_000),
    # 5.3 / 5.3-Flash are 1M-class; must beat the generic "glm" 128K fallback.
    ("glm-5.3", 1_000_000),
    ("glm-5.2", 1_000_000),
    ("glm-5.1", 200_000),
    ("glm", 128_000),
    ("kimi-k3", 1_048_576),
    ("kimi", 256_000),
    ("minimax", 192_000),
    ("gemini-2.5", 1_048_576),
    ("gemini", 1_000_000),
]
DEFAULT_CONTEXT_WINDOW = 128_000


def resolve_context_window(model_name: str | None) -> int:
    """Best-effort lookup of a model's context window size, by substring match."""
    name = str(model_name or "").lower()
    for key, window in MODEL_CONTEXT_WINDOWS:
        if key in name:
            return window
    return DEFAULT_CONTEXT_WINDOW


STRONG_MODEL_CAPABILITY_TOKENS = 1_000_000


def _coerce_declared_window(value: object) -> int | None:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def declared_window_for_session(session: object) -> int | None:
    """Admin/session-declared window if present; otherwise None."""
    return _coerce_declared_window(getattr(session, "declared_context_window", None))


def is_strong_context_model(model_name: str | None, declared: object = None) -> bool:
    """True when the endpoint capability is 1M-class.

    Uses an explicit declaration when given; otherwise the name heuristic from
    :func:`resolve_context_window`. Does not change that function's return value.
    """
    explicit = _coerce_declared_window(declared)
    if explicit is not None:
        return explicit >= STRONG_MODEL_CAPABILITY_TOKENS
    return resolve_context_window(model_name) >= STRONG_MODEL_CAPABILITY_TOKENS
