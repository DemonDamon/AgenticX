"""Unit tests for agenticx.runtime.model_context_window."""

from __future__ import annotations

from agenticx.runtime.model_context_window import (
    MIN_HARNESS_CONTEXT_WINDOW,
    harness_window_for_capability,
    resolve_context_window,
    resolve_model_capability,
)
from agenticx.studio.context_usage import resolve_context_window as resolve_from_context_usage


def test_resolve_model_capability_known_models():
    """表里记的是端点能接受多少 token，不是 harness 实际驱动的窗口。"""
    cases = [
        ("claude-sonnet-5-x", 200_000),
        ("claude-3", 200_000),
        ("gpt-5-codex", 256_000),
        ("gpt-4o", 128_000),
        ("gemini-2.5-pro", 1_048_576),
        ("gemini-1.5", 1_000_000),
        ("qwen-plus", 128_000),
        ("glm-5.2", 1_000_000),
        ("glm-5.1", 200_000),
        ("glm-4.7", 128_000),
        ("unknown-model", 128_000),
    ]
    for name, expected in cases:
        assert resolve_model_capability(name) == expected, name


def test_resolve_context_window_none_and_empty():
    assert resolve_context_window(None) == 128_000
    assert resolve_context_window("") == 128_000
    assert resolve_from_context_usage(None) == 128_000


def test_harness_window_scales_capability_down():
    """模型能吃 1M 不等于 agent 循环就该跑 1M。"""
    assert harness_window_for_capability(1_000_000) == 250_000
    assert harness_window_for_capability(1_048_576) == 262_144
    # 下限之下的能力值全部落到下限。
    assert harness_window_for_capability(256_000) == MIN_HARNESS_CONTEXT_WINDOW
    assert harness_window_for_capability(200_000) == MIN_HARNESS_CONTEXT_WINDOW


def test_harness_window_never_exceeds_the_endpoint():
    """下限必须被能力反向夹住，否则小端点会被抬到必然超窗的值。"""
    assert harness_window_for_capability(64_000) == 64_000
    assert harness_window_for_capability(8_000) == 8_000
    for capability in (8_000, 32_000, 64_000, 128_000, 256_000, 1_000_000):
        assert harness_window_for_capability(capability) <= capability


def test_resolved_window_is_the_scaled_one():
    """消费方拿到的是 harness 窗口，不是端点能力。"""
    assert resolve_model_capability("glm-5.2") == 1_000_000
    assert resolve_context_window("glm-5.2") == 250_000
    assert resolve_from_context_usage("glm-5.2") == 250_000
    # 声明值同样是端点能力，一样要缩放。
    assert resolve_context_window("glm-5.2", 128_000) == 128_000
    assert resolve_context_window("moonshot-v1-8k") == 8_000


def test_declared_window_overrides_name_heuristics():
    """管理员声明值压过名字表——这正是自部署端点比模型架构窗口小的场景。"""
    # 本地 GLM-5.2 只开到 128K，表里的 1M 是乐观猜测。
    assert resolve_model_capability("glm-5.2", 128_000) == 128_000
    assert resolve_model_capability("glm-5.2") == 1_000_000
    assert resolve_from_context_usage("glm-5.2", 128_000) == 128_000
    # 声明值高于表值时同样生效。
    assert resolve_model_capability("qwen3-32b", 256_000) == 256_000


def test_declared_window_rejects_unusable_values():
    """脏声明必须回落到启发式，而不是把窗口压成不可用的小值。"""
    for bad in (None, 0, -1, 50, 10_000_001, "", "abc", True, False, 3.5e9):
        assert resolve_model_capability("glm-5.2", bad) == 1_000_000, bad
    # 合法的字符串数字仍然接受。
    assert resolve_model_capability("glm-5.2", "128000") == 128_000


def test_explicit_suffix_in_model_name_beats_prefix_table():
    """厂商写在模型名里的窗口比家族前缀猜测可信。"""
    # 没有这条规则时 moonshot-v1-8k 会落到 128K 默认值，实际只有 8K。
    assert resolve_model_capability("moonshot-v1-8k") == 8_000
    assert resolve_model_capability("gpt-4-32k") == 32_000
    assert resolve_model_capability("qwen2.5-7b-instruct-1m") == 1_000_000


def test_parameter_count_is_not_read_as_a_window():
    """`32b` / `8b` 是参数量，不是上下文窗口。"""
    assert resolve_model_capability("qwen3-32b") == 128_000
    assert resolve_model_capability("llama3.1:8b") == 128_000
    assert resolve_model_capability("minimax-m2") == 192_000
