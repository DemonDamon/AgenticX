"""Smoke tests for Kimi K3 reasoning_effort session wiring."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import _kimi_k3_reasoning_effort_kwargs


def test_kimi_k3_reasoning_effort_kwargs_for_k3():
    session = SimpleNamespace(_reasoning_effort="high")
    assert _kimi_k3_reasoning_effort_kwargs(session, "kimi-k3") == {
        "reasoning_effort": "high"
    }
    assert _kimi_k3_reasoning_effort_kwargs(session, "moonshot/kimi-k3") == {
        "reasoning_effort": "high"
    }


def test_kimi_k3_reasoning_effort_ignored_for_other_models():
    session = SimpleNamespace(_reasoning_effort="max")
    assert _kimi_k3_reasoning_effort_kwargs(session, "kimi-k2.6") == {}
    assert _kimi_k3_reasoning_effort_kwargs(session, "glm-5.2") == {}


def test_kimi_k3_reasoning_effort_requires_valid_value():
    session = SimpleNamespace(_reasoning_effort="medium")
    assert _kimi_k3_reasoning_effort_kwargs(session, "kimi-k3") == {}
    session2 = SimpleNamespace()
    assert _kimi_k3_reasoning_effort_kwargs(session2, "kimi-k3") == {}
