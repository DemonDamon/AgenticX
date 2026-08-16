"""Smoke tests for DeepSeek V4 thinking + reasoning_effort session wiring."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _deepseek_v4_thinking_kwargs,
    _ensure_deepseek_v4_tool_reasoning_content,
    _merge_llm_call_kwargs,
)
from agenticx.runtime.group_router import _copy_group_member_runtime_flags


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


def test_ensure_fills_missing_reasoning_content_on_tool_calls():
    session = SimpleNamespace()
    history = [
        {"role": "user", "content": "查天气"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "web_search", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": "ok"},
    ]
    out = _ensure_deepseek_v4_tool_reasoning_content(
        history, session, "deepseek-v4-pro"
    )
    assert out[1]["reasoning_content"] == ""
    assert out[0].get("reasoning_content") is None
    assert out[2].get("reasoning_content") is None


def test_ensure_preserves_existing_reasoning_content():
    session = SimpleNamespace(_thinking_enabled=True)
    history = [
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "x"}}],
            "reasoning_content": "already captured",
        }
    ]
    out = _ensure_deepseek_v4_tool_reasoning_content(
        history, session, "openai/deepseek-v4-flash"
    )
    assert out[0]["reasoning_content"] == "already captured"


def test_ensure_skips_when_thinking_disabled():
    session = SimpleNamespace(_thinking_enabled=False)
    history = [
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "x"}}],
        }
    ]
    out = _ensure_deepseek_v4_tool_reasoning_content(
        history, session, "deepseek-v4-pro"
    )
    assert "reasoning_content" not in out[0]


def test_ensure_skips_other_models():
    session = SimpleNamespace()
    history = [
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "x"}}],
        }
    ]
    out = _ensure_deepseek_v4_tool_reasoning_content(history, session, "kimi-k3")
    assert "reasoning_content" not in out[0]


def test_copy_group_member_runtime_flags():
    base = SimpleNamespace(
        _thinking_enabled=False,
        _reasoning_effort="max",
        kb_retrieval_mode="always",
    )
    local = SimpleNamespace()
    _copy_group_member_runtime_flags(base, local)
    assert local._thinking_enabled is False
    assert local._reasoning_effort == "max"
    assert local.kb_retrieval_mode == "always"
