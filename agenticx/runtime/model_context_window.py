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
    ("glm-5.2", 1_000_000),
    ("glm-5.1", 200_000),
    ("glm", 128_000),
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
