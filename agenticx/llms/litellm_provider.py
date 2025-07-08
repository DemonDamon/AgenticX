from typing import Any, Optional, Dict, List, AsyncGenerator, Generator
import litellm
from pydantic import Field
from .base import BaseLLMProvider
from .response import LLMResponse, TokenUsage, LLMChoice

class LiteLLMProvider(BaseLLMProvider):
    """
    An LLM provider that uses the LiteLLM library to interface with various models.
    This provider can be used for OpenAI, Anthropic, Ollama, and any other
    provider supported by LiteLLM.
    """
    
    api_key: Optional[str] = Field(default=None, description="API key for the provider")
    base_url: Optional[str] = Field(default=None, description="Base URL for the API")
    api_version: Optional[str] = Field(default=None, description="API version to use")
    timeout: Optional[float] = Field(default=None, description="Request timeout in seconds")
    max_retries: Optional[int] = Field(default=None, description="Maximum number of retries")

    def invoke(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        try:
            response = litellm.completion(
                model=self.model,
                messages=messages,
                tools=tools,
                api_key=self.api_key,
                base_url=self.base_url,
                api_version=self.api_version,
                timeout=self.timeout,
                max_retries=self.max_retries,
                **kwargs,
            )
            return self._parse_response(response)
        except Exception as e:
            raise

    async def ainvoke(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        try:
            response = await litellm.acompletion(
                model=self.model,
                messages=messages,
                tools=tools,
                api_key=self.api_key,
                base_url=self.base_url,
                api_version=self.api_version,
                timeout=self.timeout,
                max_retries=self.max_retries,
                **kwargs,
            )
            return self._parse_response(response)
        except Exception as e:
            raise

    def stream(self, messages: List[Dict], **kwargs) -> Generator[str, None, None]:
        """Stream the language model's response synchronously."""
        response_stream = litellm.completion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            timeout=self.timeout,
            max_retries=self.max_retries,
            **kwargs
        )
        for chunk in response_stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    async def astream(self, messages: List[Dict], **kwargs) -> AsyncGenerator[str, None]:
        """Stream the language model's response asynchronously."""
        response_stream = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            timeout=self.timeout,
            max_retries=self.max_retries,
            **kwargs
        )
        async for chunk in response_stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    def _parse_response(self, response) -> LLMResponse:
        """Parses a LiteLLM ModelResponse into an AgenticX LLMResponse."""
        usage = response.usage or {}
        
        # 处理 usage 可能是字典或对象的情况
        if isinstance(usage, dict):
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            total_tokens = usage.get("total_tokens", 0)
        else:
            prompt_tokens = getattr(usage, "prompt_tokens", 0)
            completion_tokens = getattr(usage, "completion_tokens", 0)
            total_tokens = getattr(usage, "total_tokens", 0)
            
        token_usage = TokenUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens
        )

        choices = [
            LLMChoice(
                index=choice.index,
                content=choice.message.content or "",
                finish_reason=choice.finish_reason
            ) for choice in response.choices
        ]
        
        main_content = choices[0].content if choices else ""

        # 安全地获取成本信息
        cost = 0.0
        if hasattr(response, 'completion_cost'):
            cost = float(response.completion_cost) if response.completion_cost else 0.0
        elif hasattr(response, 'cost'):
            if isinstance(response.cost, dict):
                cost = response.cost.get("completion_cost", 0.0)
            else:
                cost = float(response.cost) if response.cost else 0.0

        return LLMResponse(
            id=response.id,
            model_name=response.model,
            created=response.created,
            content=main_content,
            choices=choices,
            token_usage=token_usage,
            cost=cost,
            metadata={
                "_response_ms": getattr(response, "_response_ms", None),
                "custom_llm_provider": getattr(response, "custom_llm_provider", None),
            }
        )

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "LiteLLMProvider":
        return cls(
            model=config.get("model"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url"),
            api_version=config.get("api_version"),
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
        ) 