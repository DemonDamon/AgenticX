#!/usr/bin/env python3
"""Tests for AGX config manager.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.config_manager import ConfigManager


def test_config_manager_set_and_get(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")

    ConfigManager.set_value("default_provider", "kimi", scope="project")
    ConfigManager.set_value("providers.kimi.model", "kimi-k2-0711-preview", scope="project")

    loaded = ConfigManager.load()
    assert loaded.default_provider == "kimi"
    assert loaded.providers["kimi"]["model"] == "kimi-k2-0711-preview"


def test_masked_config_masks_api_key(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")

    ConfigManager.set_value("providers.openai.api_key", "sk-abcdefgh12345678", scope="global")
    masked = ConfigManager.masked_config()
    assert masked["providers"]["openai"]["api_key"].startswith("sk-a")
    assert "12345678" not in masked["providers"]["openai"]["api_key"]


def test_load_scope_does_not_merge_global_into_project(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")

    ConfigManager.set_value("providers.openai.api_key", "sk-global-only", scope="global")
    ConfigManager.set_value("default_provider", "kimi", scope="project")
    ConfigManager.set_value("providers.kimi.model", "kimi-k2-0711-preview", scope="project")

    project_cfg = ConfigManager.load_scope("project")
    assert "openai" not in project_cfg.providers
