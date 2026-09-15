#!/usr/bin/env python3
"""Smoke tests for GLM-5.2 high/max thinking effort wiring.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _glm52_thinking_kwargs,
    _glm53_thinking_kwargs,
)


def test_glm52_defaults_to_max():
    session = SimpleNamespace()
    out = _glm52_thinking_kwargs(session, "glm-5.2")
    assert out["extra_body"]["thinking"] == {"type": "enabled"}
    assert out["extra_body"]["reasoning_effort"] == "max"
    assert _glm52_thinking_kwargs(session, "openai/glm-5.2")["extra_body"][
        "reasoning_effort"
    ] == "max"


def test_glm52_accepts_high_and_max():
    session = SimpleNamespace(_reasoning_effort="high")
    assert _glm52_thinking_kwargs(session, "glm-5.2")["extra_body"][
        "reasoning_effort"
    ] == "high"
    session_max = SimpleNamespace(_reasoning_effort="MAX")
    assert _glm52_thinking_kwargs(session_max, "zhipu/glm-5.2")["extra_body"][
        "reasoning_effort"
    ] == "max"


def test_glm52_low_falls_back_to_max():
    session = SimpleNamespace(_reasoning_effort="low")
    assert _glm52_thinking_kwargs(session, "glm-5.2")["extra_body"][
        "reasoning_effort"
    ] == "max"


def test_glm52_ignored_for_other_models():
    session = SimpleNamespace(_reasoning_effort="high")
    assert _glm52_thinking_kwargs(session, "glm-5.3-flash") == {}
    assert _glm52_thinking_kwargs(session, "kimi-k3") == {}
    assert _glm53_thinking_kwargs(session, "glm-5.2") == {}
