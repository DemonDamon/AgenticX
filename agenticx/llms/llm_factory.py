"""LLM Factory - A factory for creating LLM clients."""
from typing import cast
from agenticx.knowledge.graphers.config import LLMConfig
from .base import BaseLLMProvider
from .litellm_provider import LiteLLMProvider
from .kimi_provider import KimiProvider
from .bailian_provider import BailianProvider


class LlmFactory:
    """A factory for creating LLM clients."""

    @staticmethod
    def create_llm(config: LLMConfig) -> BaseLLMProvider:
        """
        Create an LLM client based on the provided configuration.

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
        else:
            raise ValueError(f"Unknown LLM type: {config.type}")