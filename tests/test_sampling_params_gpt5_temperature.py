#!/usr/bin/env python3
"""Smoke tests for gpt-5 / MiniMax chat temperature resolution.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.llms.sampling_params import (
    model_requires_fixed_temperature_one,
    provider_raw_enabled_for_fallback,
    resolve_chat_temperature,
)


def _chat_temperature_kwargs(model_name: str, provider_name: str) -> dict:
    """Mirror agent_runtime._chat_temperature_kwargs without importing runtime."""
    value = resolve_chat_temperature(model_name, provider=provider_name)
    if value is None:
        return {}
    return {"temperature": float(value)}


def test_gpt5_family_requires_temperature_one():
    assert model_requires_fixed_temperature_one("gpt-5.3-codex") is True
    assert model_requires_fixed_temperature_one("openai/gpt-5.5") is True
    assert model_requires_fixed_temperature_one("gpt-5-codex") is True


def test_gpt5_chat_and_non_gpt5_do_not_require_fixed_one():
    assert model_requires_fixed_temperature_one("gpt-5-chat") is False
    assert model_requires_fixed_temperature_one("gpt-5-chat-latest") is False
    assert model_requires_fixed_temperature_one("glm-5.2") is False
    assert model_requires_fixed_temperature_one("MiniMax-M2.7") is False


def test_resolve_chat_temperature_gpt5_uses_one():
    assert resolve_chat_temperature("gpt-5.3-codex", provider="openai") == 1.0
    assert resolve_chat_temperature("openai/gpt-5.5", provider="openai") == 1.0


def test_resolve_chat_temperature_minimax_omits():
    assert resolve_chat_temperature("MiniMax-M2.7", provider="minimax") is None


def test_resolve_chat_temperature_default_for_ordinary_models():
    assert resolve_chat_temperature("glm-5.2", provider="custom_openai_x") == 0.2


def test_chat_temperature_kwargs_shape():
    assert _chat_temperature_kwargs("gpt-5.3-codex", "openai") == {"temperature": 1.0}
    assert _chat_temperature_kwargs("MiniMax-M2.7", "minimax") == {}
    assert _chat_temperature_kwargs("glm-5.2", "custom_openai_x") == {"temperature": 0.2}


def test_provider_raw_enabled_for_fallback_skips_explicit_false():
    assert provider_raw_enabled_for_fallback({"enabled": False, "model": "gpt-5.3-codex"}) is False
    assert provider_raw_enabled_for_fallback({"enabled": True, "model": "MiniMax-M2.7"}) is True
    assert provider_raw_enabled_for_fallback({"model": "glm-5.2"}) is True
    assert provider_raw_enabled_for_fallback(None) is True


def test_failure_summary_keeps_provider_model_prefix():
    from agenticx.studio.turn_interruption import _last_failure_summary

    session = type(
        "S",
        (),
        {
            "scratchpad": {
                "__last_turn_failure__": {
                    "text": (
                        "模型调用失败 (openai/gpt-5.3-codex): "
                        "litellm.UnsupportedParamsError: gpt-5 models don't support temperature=0.2"
                    ),
                    "detector": "unknown",
                }
            }
        },
    )()
    summary = _last_failure_summary(session)
    assert summary.startswith("(openai/gpt-5.3-codex)")
    assert "UnsupportedParamsError" not in summary
    assert "temperature=0.2" in summary
