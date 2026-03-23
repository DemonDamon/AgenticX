#!/usr/bin/env python3
"""Tests for provider resolver defaults.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.minimax_provider import MiniMaxProvider
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.llms.qianfan_provider import QianfanProvider
from agenticx.llms.zhipu_provider import ZhipuProvider


def _setup_paths(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")


def test_resolver_uses_zhipu_default_base_url(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "zhipu", scope="global")
    ConfigManager.set_value("providers.zhipu.api_key", "zhipu-key", scope="global")
    ConfigManager.set_value("providers.zhipu.model", "glm-4-plus", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, ZhipuProvider)
    assert provider.base_url == "https://open.bigmodel.cn/api/paas/v4"
    assert provider.model == "openai/glm-4-plus"


def test_zhipu_provider_normalizes_zhipu_prefixed_model():
    provider = ZhipuProvider.from_config({"model": "zhipu/glm-5", "api_key": "k"})
    assert provider.model == "openai/glm-5"


def test_zhipu_provider_idempotent_openai_prefixed_model():
    provider = ZhipuProvider.from_config({"model": "openai/glm-5", "api_key": "k"})
    assert provider.model == "openai/glm-5"


def test_resolver_uses_qianfan_default_base_url(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "qianfan", scope="global")
    ConfigManager.set_value("providers.qianfan.api_key", "qf-key", scope="global")
    ConfigManager.set_value("providers.qianfan.model", "ernie-4.0-8k", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, QianfanProvider)
    assert provider.base_url == "https://qianfan.baidubce.com/v2"


def test_resolver_uses_minimax_default_base_url(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "minimax", scope="global")
    ConfigManager.set_value("providers.minimax.api_key", "mm-key", scope="global")
    ConfigManager.set_value("providers.minimax.model", "abab6.5s-chat", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, MiniMaxProvider)
    assert provider.base_url == "https://api.minimaxi.com/v1"
