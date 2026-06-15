#!/usr/bin/env python3
"""Tests for GAIA model registry.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.observability.gaia_model_registry import (
    GAIA_ALLOWED_MODELS,
    normalize_model_id,
    resolve_gaia_model,
)


def test_normalize_model_id_case_insensitive() -> None:
    assert normalize_model_id("qwen3.7-max") == "qwen3.7-max"
    assert normalize_model_id("GLM-5.2") == "glm-5.2"
    assert normalize_model_id("minimax-m3") == "MiniMax-M3"


def test_normalize_model_id_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="unsupported model"):
        normalize_model_id("unknown-model")


def test_allowed_models_include_user_curated_set() -> None:
    expected = {
        "gpt-5.5",
        "gpt-5.4",
        "kimi-k2.6",
        "glm-5.1",
        "glm-5.2",
        "MiniMax-M2.7",
        "MiniMax-M3",
        "qwen3.6-plus",
        "qwen3.7-max",
    }
    assert set(GAIA_ALLOWED_MODELS) == expected


def test_resolve_gaia_model_default_provider_hint() -> None:
    selection = resolve_gaia_model("qwen3.7-max")
    assert selection.model == "qwen3.7-max"
    assert selection.provider == "bailian"

    glm = resolve_gaia_model("glm-5.2")
    assert glm.model == "glm-5.2"
    assert glm.provider == "zhipu"
