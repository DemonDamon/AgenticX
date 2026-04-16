#!/usr/bin/env python3
"""Smoke tests for learning subsystem config.

Validates hermes-agent proposal v2 Phase 2 — learning.* config.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from agenticx.learning.config import DEFAULTS, get, get_learning_config


class TestDefaults:
    def test_all_keys_present(self) -> None:
        config = get_learning_config()
        for key in DEFAULTS:
            assert key in config, f"Missing default key: {key}"

    def test_default_values(self) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={}):
            with patch.dict("os.environ", {}, clear=True):
                config = get_learning_config()
                assert config["nudge_interval"] == 10
                assert config["min_tool_calls"] == 5
                assert config["auto_create"] is False
                assert config["quality_gate_min_score"] == 0.6


class TestYAMLOverride:
    def test_overrides_defaults(self) -> None:
        yaml_data = {"nudge_interval": 20, "auto_create": True}
        with patch("agenticx.learning.config._load_yaml_section", return_value=yaml_data):
            config = get_learning_config()
            assert config["nudge_interval"] == 20
            assert config["auto_create"] is True
            assert config["min_tool_calls"] == 5

    def test_invalid_type_falls_back(self) -> None:
        yaml_data = {"nudge_interval": "not_a_number"}
        with patch("agenticx.learning.config._load_yaml_section", return_value=yaml_data):
            config = get_learning_config()
            assert config["nudge_interval"] == 10


class TestEnvOverride:
    def test_agx_learning_enabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_LEARNING_ENABLED", "0")
        with patch("agenticx.learning.config._load_yaml_section", return_value={"enabled": True}):
            config = get_learning_config()
            assert config["enabled"] is False

    def test_agx_skill_review_enabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_SKILL_REVIEW_ENABLED", "1")
        with patch("agenticx.learning.config._load_yaml_section", return_value={}):
            config = get_learning_config()
            assert config["review_enabled"] is True


class TestGetAccessor:
    def test_get_existing_key(self) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={}):
            assert get("nudge_interval") == 10

    def test_get_missing_key(self) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={}):
            assert get("nonexistent", "fallback") == "fallback"

    def test_get_yaml_override(self) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={"nudge_interval": 30}):
            assert get("nudge_interval") == 30
