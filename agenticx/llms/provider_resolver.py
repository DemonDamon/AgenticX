#!/usr/bin/env python3
"""Resolve AGX config to concrete LLM providers.

Author: Damon Li
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Type

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.ark_provider import ArkLLMProvider
from agenticx.llms.bailian_provider import BailianProvider
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.deepseek_provider import DeepSeekProvider
from agenticx.llms.kimi_provider import KimiProvider
from agenticx.llms.litellm_provider import (
    LiteLLMProvider,
    normalize_litellm_model_for_openai_compat_gateway,
)
from agenticx.llms.minimax_provider import MiniMaxProvider
from agenticx.llms.qianfan_provider import QianfanProvider
from agenticx.llms.sampling_params import provider_raw_enabled_for_fallback
from agenticx.llms.zhipu_provider import ZhipuProvider


def _wechat_binding_path() -> Optional[Path]:
    """Return the desktop WeChat binding file path when it exists."""
    path = Path.home() / ".agenticx" / "wechat_binding.json"
    return path if path.is_file() else None


def _wechat_desktop_binding() -> Dict[str, Any]:
    path = _wechat_binding_path()
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    desk = data.get("_desktop") if isinstance(data, dict) else None
    return desk if isinstance(desk, dict) else {}


def effective_session_llm_names(
    provider_name: Optional[str],
    model: Optional[str],
    *,
    session_id: str = "",
) -> Tuple[str, str]:
    """Fill empty session provider/model from IM binding or active config.

    IM-bound Desktop sessions often persist without a model picker value.
    ProviderResolver then silently uses ``default_provider`` (commonly a
    disabled OpenAI gpt-5 SKU), which rejects the runtime default
    temperature=0.2.
    """
    provider = str(provider_name or "").strip()
    model_name = str(model or "").strip()
    if provider and model_name:
        return provider, model_name

    sid = str(session_id or "").strip()
    if sid:
        desk = _wechat_desktop_binding()
        bound_sid = str(desk.get("session_id") or "").strip()
        bound_provider = str(desk.get("provider") or "").strip()
        bound_model = str(desk.get("model") or "").strip()
        if bound_sid == sid and bound_provider and bound_model:
            return (
                provider or bound_provider,
                model_name or bound_model,
            )

    active_provider = str(ConfigManager.get_value("active_provider") or "").strip()
    active_model = str(ConfigManager.get_value("active_model") or "").strip()
    if active_provider and active_model:
        return (
            provider or active_provider,
            model_name or active_model,
        )
    default_provider, default_model = config_default_llm_names()
    if default_provider and default_model:
        return (
            provider or default_provider,
            model_name or default_model,
        )
    return provider, model_name


def config_default_llm_names() -> Tuple[str, str]:
    """Return the configured default channel and its default model.

    Uses ``default_provider`` plus that provider's ``model`` (or the first
    visible ``models[]`` entry) when the channel is enabled. Falls back to
    last-used ``active_provider`` / ``active_model``.
    """
    try:
        cfg = ConfigManager.load()
    except Exception:
        cfg = None
    if cfg is not None:
        provider = str(getattr(cfg, "default_provider", "") or "").strip()
        raw: Dict[str, Any] = {}
        providers = getattr(cfg, "providers", None)
        if provider and isinstance(providers, dict):
            maybe = providers.get(provider)
            if isinstance(maybe, dict):
                raw = maybe
        if provider and provider_raw_enabled_for_fallback(raw):
            model = str(raw.get("model") or "").strip()
            if not model:
                models = raw.get("models")
                if isinstance(models, list):
                    for item in models:
                        name = str(item or "").strip()
                        if name:
                            model = name
                            break
            if model:
                return provider, model
    try:
        active_provider = str(ConfigManager.get_value("active_provider") or "").strip()
        active_model = str(ConfigManager.get_value("active_model") or "").strip()
    except Exception:
        return "", ""
    if active_provider and active_model:
        return active_provider, active_model
    return "", ""


def should_fallback_to_default_model(
    *,
    already_attempted: bool,
    current_provider: str,
    current_model: str,
    default_provider: str,
    default_model: str,
) -> bool:
    """True when a one-shot retry on the configured default model is useful."""
    if already_attempted:
        return False
    default_provider = str(default_provider or "").strip()
    default_model = str(default_model or "").strip()
    if not default_provider or not default_model:
        return False
    return (
        default_provider.lower() != str(current_provider or "").strip().lower()
        or default_model != str(current_model or "").strip()
    )


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
        "deepseek": DeepSeekProvider,
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
        return bool(str(base_url or "").strip())

    @staticmethod
    def _is_legacy_custom_ollama_provider(
        provider_key: str,
        *,
        base_url: Optional[str],
    ) -> bool:
        if not provider_key.startswith("custom_ollama_"):
            return False
        return bool(str(base_url or "").strip())

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
        # Custom OpenAI-compatible gateways (e.g. MOMA): always route via openai/ so
        # LiteLLM uses the configured base_url, including vendor ids with slashes
        # such as minimax/minimax-m3.
        if provider_name == "openai" and (base_url or "").strip():
            return normalize_litellm_model_for_openai_compat_gateway(model, base_url)
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
            "extra_body",
        ):
            val = provider_cfg.get(key)
            if val is None:
                continue
            if key == "api_key" and not str(val).strip():
                continue
            kwargs[key] = val
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
            elif extra.get("interface") == "ollama" or cls._is_legacy_custom_ollama_provider(
                provider_key, base_url=provider.base_url
            ):
                provider_cls = LiteLLMProvider
                effective_key = "ollama"
            else:
                raise ValueError(f"Unsupported provider: {provider_key}")
        else:
            provider_cls = cls.PROVIDER_MAP[provider_key]
            effective_key = provider_key
        raw_cfg = asdict(provider)
        if model:
            raw_cfg["model"] = model
        kwargs = cls._build_kwargs(effective_key, raw_cfg)
        # Request-scoped task identity is an internal enterprise Gateway
        # contract.  A similarly shaped custom/self-managed provider must not
        # receive it merely because it also uses the LiteLLM transport.
        if (
            provider_cls is LiteLLMProvider
            and provider_key == "enterprise"
            and extra.get("managed") is True
        ):
            kwargs["forward_turn_id_header"] = True

        if not kwargs.get("model"):
            raise ValueError(f"Provider '{provider_key}' is missing model configuration")
        if hasattr(provider_cls, "from_config"):
            cfg: Dict[str, Any] = {}
            for key in (
                "model", "api_key", "base_url", "api_version",
                "timeout", "max_retries", "endpoint_id", "secret_key", "group_id",
                "drop_params", "extra_body",
                "forward_turn_id_header",
            ):
                val = kwargs.get(key)
                if val is not None:
                    cfg[key] = val
            return provider_cls.from_config(cfg)  # type: ignore[attr-defined]
        return provider_cls(**kwargs)
