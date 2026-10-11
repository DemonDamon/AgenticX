"""Smoke tests for Bailian hybrid Qwen thinking kwargs."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import _bailian_qwen_thinking_kwargs


def test_qwen37_max_thinking_enabled_by_default() -> None:
    session = SimpleNamespace()
    out = _bailian_qwen_thinking_kwargs(session, "qwen3.7-max", "bailian")
    assert out == {"extra_body": {"enable_thinking": True}}


def test_qwen37_max_thinking_respects_session_disable() -> None:
    session = SimpleNamespace(_thinking_enabled=False)
    out = _bailian_qwen_thinking_kwargs(session, "qwen3.7-max", "bailian")
    assert out == {"extra_body": {"enable_thinking": False}}


def test_qwen_plus_omits_enable_thinking() -> None:
    session = SimpleNamespace()
    assert _bailian_qwen_thinking_kwargs(session, "qwen-plus", "bailian") == {}
