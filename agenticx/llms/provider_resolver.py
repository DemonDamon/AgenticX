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

    @staticmethod
    def _is_legacy_custom_openai_provider(
        provider_key: str,
        *,
        api_key: Optional[str],
        base_url: Optional[str],
    ) -> bool:
        """Back-compat for desktop-created custom OpenAI vendors before interface field existed."""
        if not provider_key.startswith("custom_openai_"):
            return False
        # Require gateway-like shape to avoid accidentally routing arbitrary custom providers.
        has_base_url = bool(str(base_url or "").strip())
        has_auth = bool(str(api_key or "").strip())
        return has_base_url and has_auth

    @classmethod
    def _normalized_model(
        cls,
        provider_name: str,
        model: str,
        *,
        base_url: Optional[str] = None,
    ) -> str:
        model = str(model or "").strip()
        if not model:
            return model
        prefix = cls.MODEL_PREFIX_MAP.get(provider_name, "")
        if prefix:
            if model.startswith(prefix):
                return model
            return f"{prefix}{model}"
        # Custom OpenAI-compatible gateways (e.g. 移动云): LiteLLM cannot infer the
        # route from bare IDs like deepseek-r1 and raises BadRequestError unless the
        # model is prefixed (same idea as MiniMaxProvider).
        if provider_name == "openai" and (base_url or "").strip():
            if "/" not in model:
                return f"openai/{model}"
        return model

    @classmethod
    def _build_kwargs(cls, provider_name: str, provider_cfg: Dict[str, Any]) -> Dict[str, Any]:
        model = str(provider_cfg.get("model") or "")
        base_url_val = provider_cfg.get("base_url")
        kwargs: Dict[str, Any] = {
            "model": cls._normalized_model(
                provider_name, model, base_url=str(base_url_val) if base_url_val else None
            ),
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
        extra = provider.extra or {}
        if provider_key not in cls.PROVIDER_MAP:
            if extra.get("interface") == "openai" or cls._is_legacy_custom_openai_provider(
                provider_key, api_key=provider.api_key, base_url=provider.base_url
            ):
                provider_cls = LiteLLMProvider
                effective_key = "openai"
            else:
                raise ValueError(f"Unsupported provider: {provider_key}")
        else:
            provider_cls = cls.PROVIDER_MAP[provider_key]
            effective_key = provider_key
        raw_cfg = asdict(provider)
        if model:
            raw_cfg["model"] = model
        kwargs = cls._build_kwargs(effective_key, raw_cfg)

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
