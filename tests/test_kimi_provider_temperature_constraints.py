#!/usr/bin/env python3
"""Tests for Kimi K2.x / K3 temperature constraints.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.llms.kimi_provider import KimiProvider


def _make_fake_client(captured: dict) -> object:
    def _create(**kwargs):
        captured["params"] = kwargs
        return SimpleNamespace(
            id="resp-1",
            model=kwargs.get("model", "kimi-k2.6"),
            created=0,
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content="ok"),
                )
            ],
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create)))


def test_kimi_k2_6_enforces_temperature_one_by_default():
    captured: dict = {}
    provider = KimiProvider(model="kimi-k2.6", api_key="k",)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello")

    assert captured["params"]["temperature"] == 1.0


def test_kimi_k2_6_enforces_temperature_point_six_when_thinking_disabled():
    captured: dict = {}
    provider = KimiProvider(model="kimi-k2.6", api_key="k",)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello", thinking={"type": "disabled"})

    assert captured["params"]["temperature"] == 0.6


def test_kimi_k3_enforces_temperature_one_by_default():
    captured: dict = {}
    provider = KimiProvider(model="kimi-k3", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello")

    assert captured["params"]["temperature"] == 1.0


def test_kimi_k3_enforces_temperature_one_even_when_thinking_disabled():
    """K3 API rejects any value other than 1; do not fall back to K2's 0.6."""
    captured: dict = {}
    provider = KimiProvider(model="kimi-k3", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello", thinking={"type": "disabled"}, temperature=0.3)

    assert captured["params"]["temperature"] == 1.0


def test_kimi_k3_prefixed_model_id_also_enforces_temperature_one():
    captured: dict = {}
    provider = KimiProvider(model="moonshot/kimi-k3", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello")

    assert captured["params"]["temperature"] == 1.0
