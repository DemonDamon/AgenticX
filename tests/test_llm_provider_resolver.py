#!/usr/bin/env python3
"""Tests for provider resolver defaults.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.litellm_provider import LiteLLMProvider
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
    assert provider.base_url == "https://api.minimax.chat/v1"


def test_resolver_openai_custom_base_prefixes_model_for_litellm(tmp_path: Path, monkeypatch):
    """Bare model IDs on custom OpenAI-compatible bases need openai/ for LiteLLM routing."""
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "openai", scope="global")
    ConfigManager.set_value("providers.openai.api_key", "k", scope="global")
    ConfigManager.set_value("providers.openai.model", "deepseek-r1", scope="global")
    ConfigManager.set_value(
        "providers.openai.base_url",
        "https://zhenze-huhehaote.cmecloud.cn/v1",
        scope="global",
    )

    provider = ProviderResolver.resolve()
    assert isinstance(provider, LiteLLMProvider)
    assert provider.model == "openai/deepseek-r1"
    assert provider.base_url == "https://zhenze-huhehaote.cmecloud.cn/v1"


def test_resolver_openai_no_custom_base_leaves_model_unprefixed(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "openai", scope="global")
    ConfigManager.set_value("providers.openai.api_key", "k", scope="global")
    ConfigManager.set_value("providers.openai.model", "gpt-4o-mini", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, LiteLLMProvider)
    assert provider.model == "gpt-4o-mini"


def test_resolver_openai_custom_base_idempotent_when_model_already_prefixed(tmp_path: Path, monkeypatch):
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "openai", scope="global")
    ConfigManager.set_value("providers.openai.api_key", "k", scope="global")
    ConfigManager.set_value("providers.openai.model", "openai/deepseek-r1", scope="global")
    ConfigManager.set_value("providers.openai.base_url", "https://example.com/v1", scope="global")

    provider = ProviderResolver.resolve()
    assert provider.model == "openai/deepseek-r1"


def test_resolver_custom_provider_with_interface_openai_uses_litellm(tmp_path: Path, monkeypatch):
    """YAML providers not in PROVIDER_MAP but with extra.interface=openai resolve to LiteLLM (OpenAI范式)."""
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "custom_openai_acme", scope="global")
    ConfigManager.set_value("providers.custom_openai_acme.api_key", "k", scope="global")
    ConfigManager.set_value("providers.custom_openai_acme.model", "gpt-4o-mini", scope="global")
    ConfigManager.set_value("providers.custom_openai_acme.interface", "openai", scope="global")

    provider = ProviderResolver.resolve()
    assert isinstance(provider, LiteLLMProvider)
    assert provider.model == "gpt-4o-mini"


def test_resolver_legacy_custom_openai_provider_without_interface_uses_litellm(tmp_path: Path, monkeypatch):
    """兼容旧配置：custom_openai_* 可能缺失 interface=openai，也应按 OpenAI 兼容网关处理。"""
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("default_provider", "custom_openai_legacy", scope="global")
    ConfigManager.set_value("providers.custom_openai_legacy.api_key", "k", scope="global")
    ConfigManager.set_value("providers.custom_openai_legacy.model", "deepseek-r1", scope="global")
    ConfigManager.set_value(
        "providers.custom_openai_legacy.base_url",
        "https://zhenze-huhehaote.cmecloud.cn/v1",
        scope="global",
    )

    provider = ProviderResolver.resolve()
    assert isinstance(provider, LiteLLMProvider)
    assert provider.model == "openai/deepseek-r1"
