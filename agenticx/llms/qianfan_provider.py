#!/usr/bin/env python3
"""Baidu Qianfan provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import Field  # type: ignore

from .litellm_provider import LiteLLMProvider


class QianfanProvider(LiteLLMProvider):
    """LLM provider for Baidu Qianfan models."""

    secret_key: Optional[str] = Field(
        default=None,
        description="Optional secret key for AK/SK style auth.",
    )

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "QianfanProvider":
        return cls(
            model=config.get("model", "ernie-4.0-8k"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://qianfan.baidubce.com/v2",
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            secret_key=config.get("secret_key"),
            drop_params=config.get("drop_params"),
        )
