#!/usr/bin/env python3
"""MiniMax provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import Field  # type: ignore

from .litellm_provider import LiteLLMProvider


class MiniMaxProvider(LiteLLMProvider):
    """LLM provider for MiniMax chat models."""

    group_id: Optional[str] = Field(
        default=None,
        description="MiniMax group id for account-scoped routes.",
    )

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "MiniMaxProvider":
        return cls(
            model=config.get("model", "abab6.5s-chat"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://api.minimaxi.com/v1",
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
            group_id=config.get("group_id"),
        )
