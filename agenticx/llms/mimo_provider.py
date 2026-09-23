#!/usr/bin/env python3
"""Xiaomi MiMo provider using the official OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

from pydantic import model_validator  # type: ignore

from agenticx.llms.litellm_provider import LiteLLMProvider

_DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1"
_DEFAULT_MODEL = "mimo-v2.6-pro"


def _normalize_litellm_model_for_mimo(raw_model: str) -> str:
    """Map config/UI model ids to LiteLLM OpenAI-compatible MiMo routes.

    UI may store ``mimo/mimo-v2.6-pro``. LiteLLM must use ``openai/<id>`` with
    ``base_url`` pointing at api.xiaomimimo.com so the official gateway is used.
    """
    name = str(raw_model or "").strip() or _DEFAULT_MODEL
    if "/" in name:
        prefix, rest = name.split("/", 1)
        if prefix.lower() in ("mimo", "xiaomi", "openai") and rest.strip():
            name = rest.strip()
    if not name:
        name = _DEFAULT_MODEL
    if name.lower().startswith("openai/"):
        return name
    return f"openai/{name}"


class MimoProvider(LiteLLMProvider):
    """LLM provider for Xiaomi MiMo official OpenAI-compatible API."""

    @model_validator(mode="after")
    def _normalize_mimo_config(self) -> "MimoProvider":
        self.base_url = (self.base_url or "").strip() or _DEFAULT_MIMO_BASE_URL
        if self.model:
            self.model = _normalize_litellm_model_for_mimo(self.model)
        return self

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "MimoProvider":
        extra_body = config.get("extra_body")
        return cls(
            model=_normalize_litellm_model_for_mimo(
                str(config.get("model") or _DEFAULT_MODEL)
            ),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or _DEFAULT_MIMO_BASE_URL,
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            drop_params=config.get("drop_params"),
            extra_body=extra_body if isinstance(extra_body, dict) else None,
        )
