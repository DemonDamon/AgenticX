#!/usr/bin/env python3
"""Graphiti LLM client compatibility shims for third-party OpenAI-compatible APIs.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any

import openai
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel

from agenticx.memory.graph.json_compat import (
    coerce_to_response_model,
    parse_llm_json,
    provider_supports_json_response_format,
)
from graphiti_core.llm_client.config import DEFAULT_MAX_TOKENS, ModelSize
from graphiti_core.llm_client.errors import RateLimitError
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.prompts.models import Message

logger = logging.getLogger(__name__)


class CompatOpenAIGenericClient(OpenAIGenericClient):
    """OpenAIGenericClient that omits json_object on providers that reject it."""

    def __init__(
        self,
        config: Any = None,
        cache: bool = False,
        client: Any = None,
        *,
        provider_name: str = "",
        base_url: str | None = None,
    ) -> None:
        super().__init__(config=config, cache=cache, client=client)
        self._provider_name = (provider_name or "").strip().lower()
        self._base_url = (base_url or "").strip() or None

    async def _generate_response(
        self,
        messages: list[Message],
        response_model: type[BaseModel] | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        model_size: ModelSize = ModelSize.medium,
    ) -> dict[str, Any]:
        openai_messages: list[ChatCompletionMessageParam] = []
        for msg in messages:
            msg.content = self._clean_input(msg.content)
            if msg.role == "user":
                openai_messages.append({"role": "user", "content": msg.content})
            elif msg.role == "system":
                openai_messages.append({"role": "system", "content": msg.content})

        request: dict[str, Any] = {
            "model": self.model or "gpt-4o-mini",
            "messages": openai_messages,
            "temperature": self.temperature,
            "max_tokens": max_tokens or self.max_tokens,
        }
        if provider_supports_json_response_format(self._provider_name, self._base_url):
            request["response_format"] = {"type": "json_object"}

        try:
            response = await self.client.chat.completions.create(**request)
            content = response.choices[0].message.content or ""
            return coerce_to_response_model(parse_llm_json(content), response_model)
        except openai.RateLimitError as exc:
            raise RateLimitError from exc
        except Exception as exc:
            logger.error("memory graph LLM call failed (provider=%s): %s", self._provider_name, exc)
            raise
