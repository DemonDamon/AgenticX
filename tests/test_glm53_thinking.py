#!/usr/bin/env python3
"""Smoke tests for GLM-5.3 always-on thinking + reasoning_effort wiring.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _glm53_thinking_kwargs,
    _kimi_k3_reasoning_effort_kwargs,
    _merge_llm_call_kwargs,
)


def test_glm53_flash_defaults_to_max_and_enabled_thinking():
    session = SimpleNamespace()
    out = _glm53_thinking_kwargs(session, "glm-5.3-flash")
    assert "reasoning_effort" not in out
    assert out["extra_body"]["reasoning_effort"] == "max"
    assert out["extra_body"]["thinking"] == {"type": "enabled"}
    assert _glm53_thinking_kwargs(session, "openai/glm-5.3")["extra_body"][
        "reasoning_effort"
    ] == "max"
    assert (
        _glm53_thinking_kwargs(session, "zhipu/glm-5.3-flash")["extra_body"]["thinking"][
            "type"
        ]
        == "enabled"
    )


def test_glm53_accepts_low_high_max():
    session = SimpleNamespace(_reasoning_effort="low")
    assert _glm53_thinking_kwargs(session, "glm-5.3-flash")["extra_body"][
        "reasoning_effort"
    ] == "low"
    session_high = SimpleNamespace(_reasoning_effort="HIGH")
    assert _glm53_thinking_kwargs(session_high, "glm-5.3")["extra_body"][
        "reasoning_effort"
    ] == "high"
    session_max = SimpleNamespace(_reasoning_effort="max")
    assert _glm53_thinking_kwargs(session_max, "glm-5.3-flash")["extra_body"][
        "reasoning_effort"
    ] == "max"


def test_glm53_invalid_effort_falls_back_to_max():
    session = SimpleNamespace(_reasoning_effort="medium")
    assert _glm53_thinking_kwargs(session, "glm-5.3-flash")["extra_body"][
        "reasoning_effort"
    ] == "max"


def test_glm53_ignored_for_other_models():
    session = SimpleNamespace(_reasoning_effort="low")
    assert _glm53_thinking_kwargs(session, "glm-5.2") == {}
    assert _glm53_thinking_kwargs(session, "kimi-k3") == {}
    assert _kimi_k3_reasoning_effort_kwargs(session, "glm-5.3-flash") == {}


def test_merge_keeps_prompt_cache_extra_body():
    base = {"extra_body": {"context_management": {"mode": "on"}}, "foo": 1}
    _merge_llm_call_kwargs(
        base,
        _glm53_thinking_kwargs(
            SimpleNamespace(_reasoning_effort="high"),
            "glm-5.3-flash",
        ),
    )
    assert base["foo"] == 1
    assert "reasoning_effort" not in base
    assert base["extra_body"]["context_management"] == {"mode": "on"}
    assert base["extra_body"]["thinking"] == {"type": "enabled"}
    assert base["extra_body"]["reasoning_effort"] == "high"
