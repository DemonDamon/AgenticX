#!/usr/bin/env python3
"""MiniMax provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import Field, model_validator  # type: ignore

from .litellm_provider import LiteLLMProvider


class MiniMaxProvider(LiteLLMProvider):
    """LLM provider for MiniMax chat models."""

    group_id: Optional[str] = Field(
        default=None,
        description="MiniMax group id for account-scoped routes.",
    )

    @model_validator(mode="after")
    def _normalize_minimax_config(self) -> "MiniMaxProvider":
        model = str(self.model or "").strip()
        if model and "/" not in model:
            # MiniMax uses OpenAI-compatible endpoint; LiteLLM needs explicit provider prefix
            # for non-canonical model IDs like "MiniMax-M2.5".
            self.model = f"openai/{model}"
        if not (self.base_url or "").strip():
            self.base_url = "https://api.minimax.chat/v1"
        return self

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "MiniMaxProvider":
        return cls(
            model=config.get("model", "MiniMax-M2.5"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://api.minimax.chat/v1",
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            group_id=config.get("group_id"),
            drop_params=config.get("drop_params"),
        )
