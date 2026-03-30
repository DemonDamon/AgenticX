"""LLM Factory - A factory for creating LLM clients.

Author: Damon Li
"""
from typing import cast
from agenticx.knowledge.graphers.config import LLMConfig
from .base import BaseLLMProvider
from .litellm_provider import LiteLLMProvider
from .kimi_provider import KimiProvider
from .bailian_provider import BailianProvider
from .ark_provider import ArkLLMProvider
from .zhipu_provider import ZhipuProvider
from .qianfan_provider import QianfanProvider
from .minimax_provider import MiniMaxProvider


class LlmFactory:
    """A factory for creating LLM clients."""

    @staticmethod
    def create_llm(config: LLMConfig) -> BaseLLMProvider:
        """Create an LLM client based on the provided configuration.

        Args:
            config: The LLM configuration object.

        Returns:
            An instance of a class that inherits from BaseLLMProvider.

        Raises:
            ValueError: If the LLM type specified in the config is unknown.
        """
        llm_type = config.type.lower()

        if llm_type == "litellm":
            return LiteLLMProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                drop_params=config.drop_params,
            )
        elif llm_type == "kimi":
            return KimiProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
            )
        elif llm_type == "bailian":
            return BailianProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                timeout=config.timeout,
                max_retries=config.max_retries,
                temperature=config.temperature,
                max_tokens=config.max_tokens
            )
        elif llm_type in ("ark", "volcengine"):
            return ArkLLMProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url or "https://ark.cn-beijing.volces.com/api/v3",
                timeout=config.timeout,
                max_retries=config.max_retries,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        elif llm_type == "zhipu":
            return ZhipuProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                timeout=config.timeout,
                max_retries=config.max_retries,
            )
        elif llm_type == "qianfan":
            return QianfanProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                timeout=config.timeout,
                max_retries=config.max_retries,
            )
        elif llm_type == "minimax":
            return MiniMaxProvider(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                timeout=config.timeout,
                max_retries=config.max_retries,
            )
        else:
            raise ValueError(f"Unknown LLM type: {config.type}")