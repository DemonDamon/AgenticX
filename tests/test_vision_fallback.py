#!/usr/bin/env python3
"""Tests for vision fallback model resolution.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.llms import vision_fallback


def _patch_config(monkeypatch, *, providers: dict, override=None) -> None:
    monkeypatch.setattr(
        vision_fallback.ConfigManager,
        "load",
        staticmethod(lambda: SimpleNamespace(providers=providers)),
    )
    monkeypatch.setattr(
        vision_fallback.ConfigManager,
        "get_value",
        staticmethod(lambda key: override if key == "vision_fallback" else None),
    )


def test_explicit_override_wins(monkeypatch) -> None:
    _patch_config(
        monkeypatch,
        providers={
            "zhipu": {
                "enabled": True,
                "api_key": "k",
                "models": ["glm-5.2", "glm-4.6v"],
            }
        },
        override={"provider": "zhipu", "model": "glm-4.6v"},
    )
    info = vision_fallback.resolve_vision_fallback()
    assert info["available"] is True
    assert info["provider"] == "zhipu"
    assert info["model"] == "glm-4.6v"
    assert info["label"]


def test_prefers_session_provider_vision_sku(monkeypatch) -> None:
    _patch_config(
        monkeypatch,
        providers={
            "openai": {
                "enabled": True,
                "api_key": "k",
                "models": ["gpt-4o"],
            },
            "zhipu": {
                "enabled": True,
                "api_key": "k",
                "models": ["glm-5.2", "glm-4.6v"],
            },
        },
    )
    session = SimpleNamespace(provider_name="zhipu")
    info = vision_fallback.resolve_vision_fallback(session=session)
    assert info["available"] is True
    assert info["provider"] == "zhipu"
    assert info["model"] == "glm-4.6v"


def test_skips_disabled_uncredentialed_and_text_only(monkeypatch) -> None:
    _patch_config(
        monkeypatch,
        providers={
            "disabled_vl": {
                "enabled": False,
                "api_key": "k",
                "models": ["glm-4.6v"],
            },
            "no_creds": {
                "enabled": True,
                "models": ["gpt-4o"],
            },
            "text_only": {
                "enabled": True,
                "api_key": "k",
                "models": ["glm-5.2"],
            },
            "ok": {
                "enabled": True,
                "api_key": "k",
                "models": ["qwen2.5-vl-72b-instruct"],
            },
        },
    )
    info = vision_fallback.resolve_vision_fallback()
    assert info["available"] is True
    assert info["provider"] == "ok"
    assert info["model"] == "qwen2.5-vl-72b-instruct"


def test_unavailable_when_no_vision_model(monkeypatch) -> None:
    _patch_config(
        monkeypatch,
        providers={
            "zhipu": {
                "enabled": True,
                "api_key": "k",
                "models": ["glm-5.2"],
            }
        },
    )
    info = vision_fallback.resolve_vision_fallback()
    assert info == {"available": False, "provider": "", "model": "", "label": ""}
