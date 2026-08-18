#!/usr/bin/env python3
"""Model context window lookup shared by ToolSearch and context usage.

The table and the declared field both describe the **endpoint capability** —
how many tokens the endpoint will accept. That is not the same as the window
the agent harness should actually drive: a model being able to take 1M tokens
does not make a 1M-token agent loop a good idea, and the cost and attention
quality both argue against it. So the capability is scaled down to a working
window (see ``harness_window_for_capability``).

Capability resolution order, most trustworthy first:

1. ``declared`` — 企业管理员在后台为该模型填写的窗口，或由上游 ``/models``
   (vLLM ``max_model_len`` 等) 探测到的真实值。
2. 模型名里的显式后缀（``moonshot-v1-8k``、``qwen3-32b-128k``）。
3. 名字前缀表 —— 纯猜测，只在前两者都没有时兜底。

猜高会让 autocompact 触发得太晚、请求被上游直接拒绝；猜低只是提前压缩。
代价不对称，所以这里的兜底值一律取保守的一侧。

Author: Damon Li
"""

import re

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

# 端点能力 → harness 实际驱动的窗口。
# 1/4 让 1M 级模型落到 ~250K，与主流 agent harness 的量级一致；下限保证不会
# 因为窗口太小而反复压缩。下限必须再被能力夹住 —— 端点只有 64K 时抬到 128K
# 必然超窗，那正是这套机制要避免的失败。
HARNESS_WINDOW_RATIO = 0.25
MIN_HARNESS_CONTEXT_WINDOW = 128_000


def harness_window_for_capability(capability: int) -> int:
    """Working window for an endpoint that accepts ``capability`` tokens."""
    cap = max(1, int(capability))
    scaled = int(cap * HARNESS_WINDOW_RATIO)
    return min(cap, max(MIN_HARNESS_CONTEXT_WINDOW, scaled))

# 低于此值连系统提示词都放不下，视为脏数据。
_MIN_DECLARED_WINDOW = 4_000
_MAX_DECLARED_WINDOW = 10_000_000

# ``-8k`` / ``_128k`` / ``-1m``：厂商自己标在模型名里的窗口，比前缀表可信。
_NAME_WINDOW_RE = re.compile(r"[-_](\d+)(k|m)(?![a-z0-9])")


def _coerce_declared(declared: object) -> int | None:
    """Reject unusable declarations rather than letting them shrink the window."""
    if declared is None or isinstance(declared, bool):
        return None
    try:
        value = int(declared)
    except (TypeError, ValueError):
        return None
    if value < _MIN_DECLARED_WINDOW or value > _MAX_DECLARED_WINDOW:
        return None
    return value


def parse_context_window_from_name(model_name: str | None) -> int | None:
    """Explicit ``-8k`` / ``-1m`` suffix in the model id; ``None`` when absent.

    ``k`` 按 1000 而非 1024 折算，取保守的一侧。
    """
    name = str(model_name or "").lower()
    match = _NAME_WINDOW_RE.search(name)
    if not match:
        return None
    digits, unit = match.groups()
    try:
        scale = 1_000 if unit == "k" else 1_000_000
        value = int(digits) * scale
    except ValueError:
        return None
    if value < _MIN_DECLARED_WINDOW or value > _MAX_DECLARED_WINDOW:
        return None
    return value


def local_override_window(provider_name: str | None, model_name: str | None) -> int | None:
    """Per-model override from the Desktop developer menu (``runtime.model_context_windows``).

    自配置厂商 / 本地自部署端点没有企业目录可依赖，这是它们唯一的声明入口。
    读配置失败一律当作「没配」，绝不让配置问题冒充一个窗口值。
    """
    provider = str(provider_name or "").strip()
    model = str(model_name or "").strip()
    if not provider or not model:
        return None
    try:
        from agenticx.cli.config_manager import ConfigManager

        table = ConfigManager.get_value("runtime.model_context_windows")
    except Exception:
        return None
    if not isinstance(table, dict):
        return None
    return _coerce_declared(table.get(f"{provider}/{model}"))


def declared_window_for_session(session: object) -> int | None:
    """Effective declaration for a session: enterprise admin first, then local override.

    ``None`` 表示两处都没声明，交给模型名启发式。
    """
    admin = _coerce_declared(getattr(session, "declared_context_window", None))
    if admin is not None:
        return admin
    return local_override_window(
        getattr(session, "provider_name", None),
        getattr(session, "model_name", None),
    )


def resolve_model_capability(model_name: str | None, declared: object = None) -> int:
    """Tokens the endpoint accepts; ``declared`` (admin/upstream) always wins."""
    explicit = _coerce_declared(declared)
    if explicit is not None:
        return explicit

    from_name = parse_context_window_from_name(model_name)
    if from_name is not None:
        return from_name

    name = str(model_name or "").lower()
    for key, window in MODEL_CONTEXT_WINDOWS:
        if key in name:
            return window
    return DEFAULT_CONTEXT_WINDOW


def resolve_context_window(model_name: str | None, declared: object = None) -> int:
    """Working window the harness drives for this model."""
    return harness_window_for_capability(resolve_model_capability(model_name, declared))
