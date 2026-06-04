#!/usr/bin/env python3
"""Graphiti embedder compatibility shims for third-party OpenAI-compatible APIs.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from graphiti_core.embedder.openai import OpenAIEmbedder


def embedder_max_batch_size(provider_name: str, base_url: str | None) -> int | None:
    """Return provider-specific embedding batch cap, or None for no override."""
    provider = (provider_name or "").strip().lower()
    base = (base_url or "").strip().lower()
    if provider in {"bailian", "dashscope", "aliyun"}:
        return 10
    if "dashscope.aliyuncs.com" in base:
        return 10
    return None


class CompatOpenAIEmbedder(OpenAIEmbedder):
    """OpenAIEmbedder that chunks create_batch for providers with small input limits."""

    def __init__(
        self,
        config: Any = None,
        client: Any = None,
        *,
        provider_name: str = "",
        base_url: str | None = None,
        max_batch_size: int | None = None,
    ) -> None:
        super().__init__(config=config, client=client)
        self._max_batch_size = max_batch_size or embedder_max_batch_size(provider_name, base_url)

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        if not input_data_list:
            return []
        max_batch = self._max_batch_size
        if not max_batch or len(input_data_list) <= max_batch:
            return await super().create_batch(input_data_list)

        vectors: list[list[float]] = []
        for start in range(0, len(input_data_list), max_batch):
            chunk = input_data_list[start : start + max_batch]
            vectors.extend(await super().create_batch(chunk))
        return vectors
