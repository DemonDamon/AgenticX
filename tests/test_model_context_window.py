"""Unit tests for agenticx.runtime.model_context_window."""

from __future__ import annotations

from agenticx.runtime.model_context_window import resolve_context_window
from agenticx.studio.context_usage import (
    resolve_context_window as resolve_from_context_usage,
    resolve_usage_window,
)


def test_resolve_context_window_known_models():
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
        assert resolve_context_window(name) == expected, name
        assert resolve_from_context_usage(name) == expected, name


def test_resolve_context_window_none_and_empty():
    assert resolve_context_window(None) == 128_000
    assert resolve_context_window("") == 128_000


def test_resolve_usage_window_prefers_override_over_empty_session_model():
    assert resolve_usage_window(session_model="", override_model="") == 128_000
    assert resolve_usage_window(session_model="", override_model="MiniMax-M2.7") == 192_000
    assert resolve_usage_window(session_model="", override_model="glm-5.2") == 1_000_000
    assert resolve_usage_window(session_model="glm-5.2", override_model="MiniMax-M2.7") == 192_000
    assert resolve_usage_window(session_model="glm-5.2", override_model="") == 1_000_000
