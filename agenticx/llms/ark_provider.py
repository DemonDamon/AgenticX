#!/usr/bin/env python3
"""Volcengine Ark LLM Provider for AgenticX.

Provides native integration with Volcengine Ark (火山方舟) inference platform,
supporting models like doubao-seed series. Uses OpenAI-compatible API format.

Supports automatic credential injection from AgentKit platform environment
variables (MODEL_AGENT_NAME, MODEL_AGENT_API_KEY).

Author: Damon Li
"""

import os
import time
import json
from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union

import openai  # type: ignore
from pydantic import Field  # type: ignore
from loguru import logger  # type: ignore

from .base import BaseLLMProvider
from .response import LLMResponse, TokenUsage, LLMChoice


# Default Ark API base URL
DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

# Well-known Volcengine Ark model identifiers
ARK_KNOWN_MODELS = [
    "doubao-seed-1-6",
    "doubao-seed-1-8",
    "doubao-seed-1-8-251228",
    "doubao-pro-32k",
    "doubao-pro-128k",
    "doubao-lite-32k",
    "doubao-lite-128k",
    "deepseek-v3-1-terminus",
    "deepseek-r1-1-terminus",
]


class ArkLLMProvider(BaseLLMProvider):
    """Volcengine Ark LLM provider using OpenAI-compatible API.

    Supports Volcengine Ark inference endpoints with automatic credential
    detection from AgentKit platform environment variables.

    Configuration priority:
    1. Explicit constructor arguments
    2. Environment variables (MODEL_AGENT_NAME, MODEL_AGENT_API_KEY)
    3. Volcengine AK/SK fallback (VOLCENGINE_ACCESS_KEY, VOLCENGINE_SECRET_KEY)

    Example:
        >>> provider = ArkLLMProvider(
        ...     model="doubao-seed-1-6",
        ...     api_key="your-api-key"
        ... )
        >>> response = provider.invoke("Hello, how are you?")
        >>> print(response.content)

        >>> # Auto-detect from environment (AgentKit cloud injection)
        >>> provider = ArkLLMProvider()
    """

    model: str = Field(
        default="doubao-seed-1-6",
        description="Model name or endpoint ID (ep-xxxxx format)"
    )
    api_key: Optional[str] = Field(
        default=None,
        description="Ark API key (auto-detected from MODEL_AGENT_API_KEY or ARK_API_KEY)"
    )
    endpoint_id: Optional[str] = Field(
        default=None,
        description="Ark endpoint ID in ep-xxxxx format (auto-detected from MODEL_AGENT_NAME)"
    )
    base_url: str = Field(
        default=DEFAULT_ARK_BASE_URL,
        description="Ark API base URL"
    )
    timeout: Optional[float] = Field(
        default=120.0,
        description="Request timeout in seconds"
    )
    max_retries: Optional[int] = Field(
        default=3,
        description="Maximum number of retries for failed requests"
    )
    temperature: Optional[float] = Field(
        default=0.7,
        description="Sampling temperature (0.0 to 1.0)"
    )
    max_tokens: Optional[int] = Field(
        default=None,
        description="Maximum number of tokens to generate"
    )
    client: Optional[Any] = Field(
        default=None, exclude=True,
        description="Sync OpenAI client instance"
    )
    async_client: Optional[Any] = Field(
        default=None, exclude=True,
        description="Async OpenAI client instance"
    )

    def __init__(self, **data: Any):
        """Initialize ArkLLMProvider with auto-detection of credentials.

        Automatically reads credentials from environment variables if not
        provided explicitly. This supports AgentKit cloud deployment where
        MODEL_AGENT_NAME and MODEL_AGENT_API_KEY are injected automatically.
        """
        super().__init__(**data)

        # Auto-detect API key from environment
        if not self.api_key:
            self.api_key = (
                os.getenv("MODEL_AGENT_API_KEY")
                or os.getenv("ARK_API_KEY")
                or os.getenv("VOLCENGINE_ARK_API_KEY")
            )

        # Auto-detect endpoint ID from environment
        if not self.endpoint_id:
            self.endpoint_id = os.getenv("MODEL_AGENT_NAME")

        # If endpoint_id is provided and model is default, use endpoint_id as model
        if self.endpoint_id and self.model == "doubao-seed-1-6":
            self.model = self.endpoint_id

        # Auto-detect base URL from environment
        env_base_url = os.getenv("ARK_BASE_URL")
        if env_base_url:
            self.base_url = env_base_url

        if not self.api_key:
            logger.warning(
                "ArkLLMProvider: No API key provided. Set MODEL_AGENT_API_KEY, "
                "ARK_API_KEY environment variable, or pass api_key parameter."
            )

        # Initialize OpenAI-compatible clients
        self.client = openai.OpenAI(
            api_key=self.api_key or "placeholder",
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries or 3,
        )
        self.async_client = openai.AsyncOpenAI(
            api_key=self.api_key or "placeholder",
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries or 3,
        )

        logger.info(
            f"ArkLLMProvider initialized: model={self.model}, "
            f"endpoint_id={self.endpoint_id}, base_url={self.base_url}"
        )

    def _get_effective_model(self) -> str:
        """Get the effective model identifier to use in API calls.

        Returns endpoint_id if available (for custom endpoints),
        otherwise returns the model name.

        Returns:
            Model identifier string for API calls.
        """
        return self.endpoint_id or self.model

    def _prepare_request_params(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict]] = None,
        stream: bool = False,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Prepare request parameters for the Ark API call.

        Args:
            messages: Chat messages list.
            tools: Optional tool definitions for function calling.
            stream: Whether to enable streaming.
            **kwargs: Additional parameters to pass through.

        Returns:
            Dictionary of request parameters.
        """
        params: Dict[str, Any] = {
            "model": self._get_effective_model(),
            "messages": messages,
            "temperature": kwargs.pop("temperature", self.temperature),
        }

        if self.max_tokens is not None:
            params["max_tokens"] = kwargs.pop("max_tokens", self.max_tokens)
        elif "max_tokens" in kwargs:
            params["max_tokens"] = kwargs.pop("max_tokens")

        if stream:
            params["stream"] = True

        if tools:
            params["tools"] = tools

        # Pass through any remaining kwargs
        params.update(kwargs)

        return params

    def _convert_prompt_to_messages(
        self, prompt: Union[str, List[Dict]]
    ) -> List[Dict[str, Any]]:
        """Convert prompt input to messages format.

        Args:
            prompt: String prompt or list of message dicts.

        Returns:
            List of message dictionaries.

        Raises:
            ValueError: If prompt type is not supported.
        """
        if isinstance(prompt, str):
            return [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            return prompt
        else:
            raise ValueError(
                "Prompt must be either a string or a list of message dictionaries"
            )

    def _parse_response(self, response: Any) -> LLMResponse:
        """Parse OpenAI-compatible response into AgenticX LLMResponse format.

        Args:
            response: Raw API response object.

        Returns:
            Standardized LLMResponse object.
        """
        usage = response.usage
        token_usage = TokenUsage(
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
        )

        choices = []
        for choice in response.choices:
            content = ""
            if hasattr(choice, "message") and choice.message:
                content = choice.message.content or ""
            choices.append(
                LLMChoice(
                    index=choice.index,
                    content=content,
                    finish_reason=choice.finish_reason,
                )
            )

        main_content = choices[0].content if choices else ""

        return LLMResponse(
            id=response.id,
            model_name=response.model,
            created=response.created,
            content=main_content,
            choices=choices,
            token_usage=token_usage,
            cost=None,
            metadata={
                "provider": "ark",
                "endpoint_id": self.endpoint_id,
                "base_url": self.base_url,
            },
        )

    def invoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """Invoke the Ark model synchronously.

        Args:
            prompt: Input prompt string or message list.
            tools: Optional tool definitions for function calling.
            **kwargs: Additional parameters (temperature, max_tokens, etc.).

        Returns:
            LLMResponse with the model output.

        Raises:
            Exception: If the API call fails after retries.
        """
        try:
            messages = self._convert_prompt_to_messages(prompt)
            params = self._prepare_request_params(
                messages, tools=tools, **kwargs
            )

            logger.info(
                f"Ark API request: model={self._get_effective_model()}, "
                f"messages={len(messages)}, temperature={params.get('temperature')}"
            )
            logger.debug(
                f"Request params keys: {list(params.keys())}"
            )

            if self.client is None:
                raise ValueError("Sync client not initialized")

            response = self.client.chat.completions.create(**params)

            # Log response info
            if hasattr(response, "usage") and response.usage:
                logger.debug(
                    f"Token usage: prompt={response.usage.prompt_tokens}, "
                    f"completion={response.usage.completion_tokens}, "
                    f"total={response.usage.total_tokens}"
                )

            parsed = self._parse_response(response)
            logger.info("Ark API call completed successfully")
            return parsed

        except Exception as e:
            logger.error(f"Ark API call failed: {str(e)}")
            raise Exception(f"Ark API call failed: {str(e)}") from e

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        """Invoke the Ark model asynchronously.

        Args:
            prompt: Input prompt string or message list.
            tools: Optional tool definitions for function calling.
            **kwargs: Additional parameters.

        Returns:
            LLMResponse with the model output.

        Raises:
            Exception: If the API call fails.
        """
        try:
            messages = self._convert_prompt_to_messages(prompt)
            params = self._prepare_request_params(
                messages, tools=tools, **kwargs
            )

            logger.info(
                f"Ark async API request: model={self._get_effective_model()}, "
                f"messages={len(messages)}"
            )

            if self.async_client is None:
                raise ValueError("Async client not initialized")

            response = await self.async_client.chat.completions.create(**params)

            parsed = self._parse_response(response)
            logger.info("Ark async API call completed successfully")
            return parsed

        except Exception as e:
            logger.error(f"Ark async API call failed: {str(e)}")
            raise Exception(f"Ark async API call failed: {str(e)}") from e

    def stream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> Generator[Union[str, Dict], None, None]:
        """Stream the Ark model response synchronously.

        Yields token-by-token output from the model.

        Args:
            prompt: Input prompt string or message list.
            **kwargs: Additional parameters.

        Yields:
            String chunks of the response content.

        Raises:
            Exception: If the streaming call fails.
        """
        try:
            messages = self._convert_prompt_to_messages(prompt)
            params = self._prepare_request_params(
                messages, stream=True, **kwargs
            )

            logger.info(
                f"Ark streaming request: model={self._get_effective_model()}"
            )

            if self.client is None:
                raise ValueError("Sync client not initialized")

            response_stream = self.client.chat.completions.create(**params)

            for chunk in response_stream:
                if (
                    chunk.choices
                    and chunk.choices[0].delta
                    and chunk.choices[0].delta.content
                ):
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"Ark streaming call failed: {str(e)}")
            raise Exception(f"Ark streaming call failed: {str(e)}") from e

    async def astream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> AsyncGenerator[Union[str, Dict], None]:
        """Stream the Ark model response asynchronously.

        Yields token-by-token output from the model.

        Args:
            prompt: Input prompt string or message list.
            **kwargs: Additional parameters.

        Yields:
            String chunks of the response content.

        Raises:
            Exception: If the streaming call fails.
        """
        try:
            messages = self._convert_prompt_to_messages(prompt)
            params = self._prepare_request_params(
                messages, stream=True, **kwargs
            )

            logger.info(
                f"Ark async streaming request: model={self._get_effective_model()}"
            )

            if self.async_client is None:
                raise ValueError("Async client not initialized")

            response_stream = await self.async_client.chat.completions.create(
                **params
            )

            async for chunk in response_stream:
                if (
                    chunk.choices
                    and chunk.choices[0].delta
                    and chunk.choices[0].delta.content
                ):
                    yield chunk.choices[0].delta.content

        except Exception as e:
            logger.error(f"Ark async streaming call failed: {str(e)}")
            raise Exception(
                f"Ark async streaming call failed: {str(e)}"
            ) from e

    def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate text response from a simple prompt string.

        Convenience method that returns just the content string.

        Args:
            prompt: Input prompt string.
            **kwargs: Additional generation parameters.

        Returns:
            Generated text content as string.
        """
        response = self.invoke(prompt, **kwargs)
        return response.content

    def call(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> str:
        """Call method for compatibility with extractors and other interfaces.

        Args:
            prompt: Input prompt.
            **kwargs: Additional parameters.

        Returns:
            Generated text content as string.
        """
        response = self.invoke(prompt, **kwargs)
        return response.content

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "ArkLLMProvider":
        """Create ArkLLMProvider from configuration dictionary.

        Args:
            config: Configuration dictionary with keys like model, api_key,
                    endpoint_id, base_url, timeout, max_retries, temperature.

        Returns:
            Configured ArkLLMProvider instance.
        """
        return cls(
            model=config.get("model", "doubao-seed-1-6"),
            api_key=config.get("api_key"),
            endpoint_id=config.get("endpoint_id"),
            base_url=config.get("base_url", DEFAULT_ARK_BASE_URL),
            timeout=config.get("timeout", 120.0),
            max_retries=config.get("max_retries", 3),
            temperature=config.get("temperature", 0.7),
            max_tokens=config.get("max_tokens"),
        )

    @classmethod
    def from_agentkit_env(cls) -> "ArkLLMProvider":
        """Create ArkLLMProvider from AgentKit platform environment variables.

        This factory method is designed for use within AgentKit Runtime
        where MODEL_AGENT_NAME and MODEL_AGENT_API_KEY are automatically
        injected by the platform.

        Returns:
            ArkLLMProvider configured from environment.

        Raises:
            ValueError: If required environment variables are not set.
        """
        endpoint_id = os.getenv("MODEL_AGENT_NAME")
        api_key = os.getenv("MODEL_AGENT_API_KEY")

        if not endpoint_id:
            raise ValueError(
                "MODEL_AGENT_NAME environment variable is not set. "
                "This method is intended for AgentKit Runtime environments."
            )
        if not api_key:
            raise ValueError(
                "MODEL_AGENT_API_KEY environment variable is not set. "
                "This method is intended for AgentKit Runtime environments."
            )

        return cls(
            endpoint_id=endpoint_id,
            api_key=api_key,
        )
