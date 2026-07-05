#!/usr/bin/env python3
"""Smoke tests for provider display labels.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.llms.provider_display import (
    build_provider_catalog_block,
    format_model_option_label,
    get_provider_display_name,
    normalize_bare_model_id,
    provider_breakdown_label,
)


def test_normalize_bare_model_id_strips_gateway_prefix() -> None:
    assert normalize_bare_model_id("ZHIPU/GLM-5.2") == "GLM-5.2"
    assert normalize_bare_model_id("kimi-k2.6") == "kimi-k2.6"


def test_format_model_option_label_uses_display_name() -> None:
    assert (
        format_model_option_label(
            "custom_openai_moma",
            "ZHIPU/GLM-5.2",
            {"display_name": "MOMA"},
        )
        == "MOMA/GLM-5.2"
    )
    assert (
        format_model_option_label(
            "custom_openai_1782269503107",
            "kimi-k2.6",
            {"display_name": "彩讯-外网"},
        )
        == "彩讯-外网/kimi-k2.6"
    )


def test_get_provider_display_name_hides_raw_custom_ids() -> None:
    assert get_provider_display_name("custom_openai_legacy") == "历史厂商"
    assert get_provider_display_name("custom_openai_moma", {"display_name": "MOMA"}) == "MOMA"


def test_provider_breakdown_label_reads_config(monkeypatch) -> None:
    class _Cfg:
        providers = {
            "custom_openai_moma": {"display_name": "MOMA", "models": ["ZHIPU/GLM-5.2"]},
        }

    monkeypatch.setattr(
        "agenticx.llms.provider_display.load_provider_configs",
        lambda: _Cfg.providers,
    )
    assert provider_breakdown_label("custom_openai_moma") == "MOMA"
    assert provider_breakdown_label("custom_openai_deleted") == "历史厂商"


def test_build_provider_catalog_block_mentions_display_names() -> None:
    block = build_provider_catalog_block(
        current_provider="custom_openai_moma",
        current_model="ZHIPU/GLM-5.2",
    )
    assert "MOMA/GLM-5.2" in block
    assert "custom_openai_*" in block
