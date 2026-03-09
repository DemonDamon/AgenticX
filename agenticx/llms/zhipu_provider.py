#!/usr/bin/env python3
"""Zhipu (GLM) provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

from .litellm_provider import LiteLLMProvider


class ZhipuProvider(LiteLLMProvider):
    """LLM provider for Zhipu GLM models."""

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "ZhipuProvider":
        raw_model = str(config.get("model", "glm-4-plus"))
        # LiteLLM expects explicit provider prefix for OpenAI-compatible routes.
        model = raw_model if "/" in raw_model else f"openai/{raw_model}"
        return cls(
            model=model,
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://open.bigmodel.cn/api/paas/v4",
            timeout=config.get("timeout", 45.0),
            max_retries=config.get("max_retries", 1),
        )
