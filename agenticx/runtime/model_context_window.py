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

不做运行时自校正窗口
====================
不做"实测溢出就自动收紧窗口"的运行时自校正。三层兜底（admin declared → 名字后缀
→ 前缀表）覆盖了绝大部分场景；剩下的 1% 是 admin 没配对自部署模型——一次性配置
就能解决，不需要运行时逻辑。

而且"只紧不松"意味着任何一次误收（上游临时限流、provider 返回了 misleading 的
context-length-exceeded 错误）都是永久性的。如果要做，还需要"如何确认收紧是对的"
这套验证，得不偿失。

前缀表里 DeepSeek V4 = 1M 是**硬编码声明**，不是等 provider 上报——因为自部署
端点经常不报或报错值。这是 floor，admin declared 能覆盖它。

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
    # V4 全系（Pro / Flash）都是 1M。0731 那版实际是 1,310,720，但这里按 1M 记：
    # 猜低只是提前压缩，猜高会让 autocompact 触发太晚、被上游直接拒。
    ("deepseek-v4", 1_048_576),
    ("deepseek", 128_000),
    ("qwen", 128_000),
    ("glm-5.2", 1_000_000),
    ("glm-5.1", 200_000),
    ("glm", 128_000),
    # K3 是 1M（1,048,576）。前缀表先命中者胜，所以更具体的条目必须排在 "kimi" 前面，
    # 否则 kimi-k3 会落到下面那条 256K —— 既让 harness 窗口卡在 128K 下限，也会被
    # is_strong_context_model 误判成弱模型。
    ("kimi-k3", 1_048_576),
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


def provider_is_enterprise_managed(provider_name: str | None) -> bool:
    """True when this provider's catalog is pushed down by the enterprise console.

    Desktop marks the synced provider with ``managed: true``; everything under a
    managed provider is the admin's call, not the machine's.
    """
    provider = str(provider_name or "").strip()
    if not provider:
        return False
    try:
        from agenticx.cli.config_manager import ConfigManager

        providers = ConfigManager.get_value("providers")
    except Exception:
        return False
    if not isinstance(providers, dict):
        return False
    entry = providers.get(provider)
    return isinstance(entry, dict) and entry.get("managed") is True


def local_override_window(provider_name: str | None, model_name: str | None) -> int | None:
    """Per-model override from the Desktop model dialog (``runtime.model_context_windows``).

    自配置厂商 / 本地自部署端点没有企业目录可依赖，这是它们唯一的声明入口。
    托管厂商则完全不吃这张表 —— 企业统一管理的模型不该被本机设置改动，哪怕
    管理员那边留空也不行，否则登录前留下的值会在登录后悄悄复活。
    读配置失败一律当作「没配」，绝不让配置问题冒充一个窗口值。
    """
    provider = str(provider_name or "").strip()
    model = str(model_name or "").strip()
    if not provider or not model:
        return None
    if provider_is_enterprise_managed(provider):
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


#: 端点能力到这个量级就算「强模型」。
#:
#: 分界放在 1M 而不是 512K：1M 是明确被点名的那一侧，而 512K–1M 之间的模型归入弱侧，
#: 保留现有行为（更保守的一侧）。注意 512K 以下的能力值在 harness 窗口上是**看不出
#: 差别**的 —— harness = min(cap, max(128K, cap × 0.25))，cap ≤ 512K 时恒等于 128K。
STRONG_MODEL_CAPABILITY_TOKENS = 1_000_000


def is_strong_context_model(model_name: str | None, declared: object = None) -> bool:
    """按**端点能力**判定强弱，不是按 harness 窗口。

    这个区别是本函数存在的全部理由：1M 模型的 harness 窗口是 262K，拿它去和 512K
    比会得出「弱模型」—— 正好反了。
    """
    return resolve_model_capability(model_name, declared) >= STRONG_MODEL_CAPABILITY_TOKENS
