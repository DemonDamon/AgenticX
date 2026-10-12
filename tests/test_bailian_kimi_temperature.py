#!/usr/bin/env python3
"""Bailian path must force temperature=1 for Kimi K3 / K2.7 SKUs.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.llms.bailian_provider import BailianProvider


def _make_fake_client(captured: dict) -> object:
    def _create(**kwargs):
        captured["params"] = kwargs
        return SimpleNamespace(
            id="resp-1",
            model=kwargs.get("model", "kimi-k3"),
            created=0,
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
            choices=[
                SimpleNamespace(
                    index=0,
                    finish_reason="stop",
                    message=SimpleNamespace(content="ok", tool_calls=None),
                )
            ],
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create)))


def test_bailian_kimi_k3_rewrites_runtime_default_temperature():
    captured: dict = {}
    provider = BailianProvider(model="kimi-k3", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello", temperature=0.2)

    assert captured["params"]["temperature"] == 1.0


def test_bailian_kimi_k3_prefixed_model_also_forces_one():
    captured: dict = {}
    provider = BailianProvider(model="bailian/kimi-k3", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello", temperature=0.2)

    assert captured["params"]["temperature"] == 1.0


def test_bailian_ordinary_qwen_keeps_caller_temperature():
    captured: dict = {}
    provider = BailianProvider(model="qwen-max", api_key="k", temperature=0.6)
    provider.client = _make_fake_client(captured)

    provider.invoke("hello", temperature=0.2)

    assert captured["params"]["temperature"] == 0.2
