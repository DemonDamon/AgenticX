#!/usr/bin/env python3
"""Resolve AGX config to concrete LLM providers.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, Optional, Type

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.ark_provider import ArkLLMProvider
from agenticx.llms.bailian_provider import BailianProvider
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.kimi_provider import KimiProvider
from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.llms.minimax_provider import MiniMaxProvider
from agenticx.llms.qianfan_provider import QianfanProvider
from agenticx.llms.zhipu_provider import ZhipuProvider


class ProviderResolver:
    """Resolve provider config into provider implementation instances."""

    PROVIDER_MAP: Dict[str, Type[BaseLLMProvider]] = {
        "openai": LiteLLMProvider,
        "anthropic": LiteLLMProvider,
        "zhipu": ZhipuProvider,
        "volcengine": ArkLLMProvider,
        "ark": ArkLLMProvider,
        "bailian": BailianProvider,
        "qianfan": QianfanProvider,
        "kimi": KimiProvider,
        "minimax": MiniMaxProvider,
        "ollama": LiteLLMProvider,
    }

    MODEL_PREFIX_MAP = {
        "anthropic": "anthropic/",
        "ollama": "ollama/",
    }

    @classmethod
    def _normalized_model(cls, provider_name: str, model: str) -> str:
        prefix = cls.MODEL_PREFIX_MAP.get(provider_name, "")
        if not prefix or model.startswith(prefix):
            return model
        return f"{prefix}{model}"

    @classmethod
    def _build_kwargs(cls, provider_name: str, provider_cfg: Dict[str, Any]) -> Dict[str, Any]:
        model = str(provider_cfg.get("model") or "")
        kwargs: Dict[str, Any] = {
            "model": cls._normalized_model(provider_name, model),
        }
        for key in (
            "api_key",
            "base_url",
            "api_version",
            "timeout",
            "max_retries",
            "endpoint_id",
            "secret_key",
            "group_id",
            "drop_params",
        ):
            if provider_cfg.get(key) is not None:
                kwargs[key] = provider_cfg[key]
        return kwargs

    @classmethod
    def resolve(
        cls,
        provider_name: Optional[str] = None,
        model: Optional[str] = None,
    ) -> BaseLLMProvider:
        """Resolve provider using merged AGX config."""
        config = ConfigManager.load()
        provider = config.get_provider(provider_name or config.default_provider)
        provider_key = provider.name.lower()
        if provider_key not in cls.PROVIDER_MAP:
            raise ValueError(f"Unsupported provider: {provider_key}")

        provider_cls = cls.PROVIDER_MAP[provider_key]
        raw_cfg = asdict(provider)
        if model:
            raw_cfg["model"] = model
        kwargs = cls._build_kwargs(provider_key, raw_cfg)

        if not kwargs.get("model"):
            raise ValueError(f"Provider '{provider_key}' is missing model configuration")
        if hasattr(provider_cls, "from_config"):
            cfg: Dict[str, Any] = {}
            for key in (
                "model", "api_key", "base_url", "api_version",
                "timeout", "max_retries", "endpoint_id", "secret_key", "group_id",
                "drop_params",
            ):
                val = kwargs.get(key)
                if val is not None:
                    cfg[key] = val
            return provider_cls.from_config(cfg)  # type: ignore[attr-defined]
        return provider_cls(**kwargs)
