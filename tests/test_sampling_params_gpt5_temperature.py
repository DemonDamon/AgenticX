#!/usr/bin/env python3
"""Smoke tests for gpt-5 / MiniMax chat temperature resolution.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.llms.sampling_params import (
    model_requires_fixed_temperature_one,
    provider_raw_enabled_for_fallback,
    resolve_chat_temperature,
    sanitize_chat_call_kwargs,
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


def test_resolve_chat_temperature_empty_model_uses_fallback_gpt5():
    """Empty session model must not keep default 0.2 when the live LLM is gpt-5."""
    assert resolve_chat_temperature("", fallback_model="gpt-5.3-codex") == 1.0
    assert resolve_chat_temperature("", provider="openai", fallback_model="openai/gpt-5.5") == 1.0


def test_sanitize_chat_call_kwargs_rewrites_gpt5_temperature():
    out = sanitize_chat_call_kwargs(
        {"temperature": 0.2, "max_tokens": 128},
        "gpt-5.3-codex",
        provider="openai",
    )
    assert out["temperature"] == 1.0
    assert out["max_tokens"] == 128


def test_litellm_provider_rewrites_gpt5_temperature():
    from agenticx.llms.litellm_provider import LiteLLMProvider

    provider = LiteLLMProvider(model="gpt-5.3-codex", api_key="k")
    kwargs = {"temperature": 0.2, "max_tokens": 64}
    provider._apply_sampling_constraints(kwargs)
    assert kwargs["temperature"] == 1.0


def test_sanitize_chat_call_kwargs_omits_minimax_temperature():
    out = sanitize_chat_call_kwargs(
        {"temperature": 0.2, "max_tokens": 128},
        "MiniMax-M2.7",
        provider="minimax",
    )
    assert "temperature" not in out
    assert out["max_tokens"] == 128


def test_chat_temperature_kwargs_shape():
    assert _chat_temperature_kwargs("gpt-5.3-codex", "openai") == {"temperature": 1.0}
    assert _chat_temperature_kwargs("MiniMax-M2.7", "minimax") == {}
    assert _chat_temperature_kwargs("glm-5.2", "custom_openai_x") == {"temperature": 0.2}


def test_provider_raw_enabled_for_fallback_skips_explicit_false():
    assert provider_raw_enabled_for_fallback({"enabled": False, "model": "gpt-5.3-codex"}) is False
    assert provider_raw_enabled_for_fallback({"enabled": True, "model": "MiniMax-M2.7"}) is True
    assert provider_raw_enabled_for_fallback({"model": "glm-5.2"}) is True
    assert provider_raw_enabled_for_fallback(None) is True


def test_effective_session_llm_names_uses_wechat_binding(tmp_path, monkeypatch):
    from agenticx.llms.provider_resolver import effective_session_llm_names

    binding = tmp_path / "wechat_binding.json"
    binding.write_text(
        '{"_desktop":{"session_id":"sid-im","provider":"minimax","model":"MiniMax-M2.7"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "agenticx.llms.provider_resolver._wechat_binding_path",
        lambda: binding,
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.get_value",
        lambda key: "",
    )
    assert effective_session_llm_names("", "", session_id="sid-im") == (
        "minimax",
        "MiniMax-M2.7",
    )


def test_effective_session_llm_names_uses_active_when_unbound(monkeypatch):
    from agenticx.llms.provider_resolver import effective_session_llm_names

    monkeypatch.setattr(
        "agenticx.llms.provider_resolver._wechat_binding_path",
        lambda: None,
    )
    values = {"active_provider": "custom_openai_x", "active_model": "glm-5.2"}
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.get_value",
        lambda key: values.get(key, ""),
    )
    assert effective_session_llm_names("", "", session_id="other") == (
        "custom_openai_x",
        "glm-5.2",
    )


def test_is_model_param_compat_error_detects_gpt5_temperature():
    from agenticx.llms.provider_fault import is_model_param_compat_error

    exc = RuntimeError(
        "gpt-5 models (including gpt-5-codex) don't support temperature=0.2. "
        "Only temperature=1 is supported."
    )
    assert is_model_param_compat_error(exc) is True
    assert is_model_param_compat_error(RuntimeError("connection reset")) is False


def test_should_fallback_to_default_model_skips_same_or_repeat():
    from agenticx.llms.provider_resolver import should_fallback_to_default_model

    assert (
        should_fallback_to_default_model(
            already_attempted=False,
            current_provider="openai",
            current_model="gpt-5.3-codex",
            default_provider="custom_openai_x",
            default_model="glm-5.2",
        )
        is True
    )
    assert (
        should_fallback_to_default_model(
            already_attempted=True,
            current_provider="openai",
            current_model="gpt-5.3-codex",
            default_provider="custom_openai_x",
            default_model="glm-5.2",
        )
        is False
    )
    assert (
        should_fallback_to_default_model(
            already_attempted=False,
            current_provider="custom_openai_x",
            current_model="glm-5.2",
            default_provider="custom_openai_x",
            default_model="glm-5.2",
        )
        is False
    )


def test_config_default_llm_names_uses_enabled_default_provider(monkeypatch):
    from agenticx.llms import provider_resolver as pr

    class _Cfg:
        default_provider = "custom_openai_x"
        providers = {
            "custom_openai_x": {
                "enabled": True,
                "model": "glm-5.2",
                "models": ["glm-5.2", "kimi-k2.6"],
            }
        }

    monkeypatch.setattr(pr.ConfigManager, "load", staticmethod(lambda: _Cfg()))
    assert pr.config_default_llm_names() == ("custom_openai_x", "glm-5.2")


def test_effective_session_llm_names_keeps_explicit():
    from agenticx.llms.provider_resolver import effective_session_llm_names

    assert effective_session_llm_names("zhipu", "glm-5.2", session_id="sid") == (
        "zhipu",
        "glm-5.2",
    )


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
