"""Smoke tests for DeepSeek V4 thinking + reasoning_effort session wiring."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _deepseek_v4_thinking_kwargs,
    _merge_llm_call_kwargs,
)


def test_enabled_high_default():
    session = SimpleNamespace()
    out = _deepseek_v4_thinking_kwargs(session, "deepseek-v4-flash")
    assert "reasoning_effort" not in out
    assert out["extra_body"]["reasoning_effort"] == "high"
    assert out["extra_body"]["thinking"] == {"type": "enabled"}
    assert _deepseek_v4_thinking_kwargs(session, "openai/deepseek-v4-pro")[
        "extra_body"
    ]["reasoning_effort"] == "high"
    assert (
        _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro-0813")["extra_body"][
            "thinking"
        ]["type"]
        == "enabled"
    )


def test_max_effort():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="max")
    out = _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro")
    assert "reasoning_effort" not in out
    assert out["extra_body"]["reasoning_effort"] == "max"


def test_disabled_omits_effort():
    session = SimpleNamespace(_thinking_enabled=False, _reasoning_effort="max")
    out = _deepseek_v4_thinking_kwargs(session, "deepseek-v4-flash")
    assert "reasoning_effort" not in out
    assert "reasoning_effort" not in out["extra_body"]
    assert out["extra_body"]["thinking"] == {"type": "disabled"}


def test_ignored_for_other_models():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="max")
    assert _deepseek_v4_thinking_kwargs(session, "kimi-k3") == {}
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-chat") == {}


def test_invalid_effort_falls_back_to_high():
    session = SimpleNamespace(_thinking_enabled=True, _reasoning_effort="low")
    assert _deepseek_v4_thinking_kwargs(session, "deepseek-v4-pro")["extra_body"][
        "reasoning_effort"
    ] == "high"


def test_merge_llm_call_kwargs_keeps_existing_extra_body():
    base = {"extra_body": {"context_management": {"mode": "on"}}, "foo": 1}
    _merge_llm_call_kwargs(
        base,
        {
            "extra_body": {
                "thinking": {"type": "enabled"},
                "reasoning_effort": "max",
            },
        },
    )
    assert base["foo"] == 1
    assert "reasoning_effort" not in base
    assert base["extra_body"]["context_management"] == {"mode": "on"}
    assert base["extra_body"]["thinking"] == {"type": "enabled"}
    assert base["extra_body"]["reasoning_effort"] == "max"
