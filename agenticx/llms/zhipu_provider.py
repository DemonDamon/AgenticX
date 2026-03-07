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
        return cls(
            model=config.get("model", "glm-4-plus"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://open.bigmodel.cn/api/paas/v4",
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
        )
