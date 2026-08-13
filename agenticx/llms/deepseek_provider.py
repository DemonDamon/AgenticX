#!/usr/bin/env python3
"""DeepSeek provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

from pydantic import model_validator  # type: ignore

from .litellm_provider import LiteLLMProvider

_DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
_DEFAULT_MODEL = "deepseek-v4-pro"


def _normalize_litellm_model_for_deepseek(raw_model: str) -> str:
    """Map config/UI model ids to LiteLLM OpenAI-compatible DeepSeek routes.

    UI may store ``deepseek/deepseek-v4-pro``; LiteLLM must use ``openai/<id>``
    with ``base_url`` pointing at api.deepseek.com so the official gateway is
    used instead of LiteLLM's native ``deepseek/`` route.
    """
    name = str(raw_model or "").strip() or _DEFAULT_MODEL
    if "/" in name:
        prefix, rest = name.split("/", 1)
        if prefix.lower() in ("deepseek", "openai") and rest.strip():
            name = rest.strip()
    if not name:
        name = _DEFAULT_MODEL
    if name.lower().startswith("openai/"):
        return name
    return f"openai/{name}"


class DeepSeekProvider(LiteLLMProvider):
    """LLM provider for DeepSeek official OpenAI-compatible API."""

    @model_validator(mode="after")
    def _normalize_deepseek_config(self) -> "DeepSeekProvider":
        self.base_url = (self.base_url or "").strip() or _DEFAULT_DEEPSEEK_BASE_URL
        if self.model:
            self.model = _normalize_litellm_model_for_deepseek(self.model)
        return self

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "DeepSeekProvider":
        extra_body = config.get("extra_body")
        return cls(
            model=_normalize_litellm_model_for_deepseek(
                str(config.get("model") or _DEFAULT_MODEL)
            ),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or _DEFAULT_DEEPSEEK_BASE_URL,
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            drop_params=config.get("drop_params"),
            extra_body=extra_body if isinstance(extra_body, dict) else None,
        )
