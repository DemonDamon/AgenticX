import asyncio
from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union, cast
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
        self, prompt: Union[str, List[Dict]], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        # 处理不同的输入类型
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            messages = prompt
        else:
            raise ValueError(f"Unsupported prompt type: {type(prompt)}")
            
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
        self, prompt: Union[str, List[Dict]], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        # 处理不同的输入类型
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            messages = prompt
        else:
            raise ValueError(f"Unsupported prompt type: {type(prompt)}")
            
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

    def stream(self, prompt: Union[str, List[Dict]], **kwargs) -> Generator[Union[str, Dict], None, None]:
        """Stream the language model's response synchronously."""
        # 处理不同的输入类型
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            messages = prompt
        else:
            raise ValueError(f"Unsupported prompt type: {type(prompt)}")
            
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
        try:
            for chunk in response_stream:
                # 使用 cast 来告诉类型检查器 chunk 的类型
                chunk = cast(Any, chunk)
                # 检查 chunk 是否有 choices 属性，并且不是 None
                if hasattr(chunk, 'choices') and chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'content') and delta.content:
                        yield delta.content
        except Exception as e:
            # 处理可能的异常
            raise e

    async def _astream_generator(self, prompt: Union[str, List[Dict]], **kwargs) -> AsyncGenerator[Union[str, Dict], None]:
        """Internal method to create the async generator for streaming."""
        # 处理不同的输入类型
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            messages = prompt
        else:
            raise ValueError(f"Unsupported prompt type: {type(prompt)}")
            
        # 获取流式响应
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
        
        # 异步迭代处理流式响应
        try:
            # 告诉类型检查器 response_stream 是可异步迭代的
            async_stream = cast(AsyncGenerator[Any, None], response_stream)
            async for chunk in async_stream:
                # 使用 cast 来告诉类型检查器 chunk 的类型
                chunk = cast(Any, chunk)
                # 检查 chunk 是否有 choices 属性，并且不是 None
                if hasattr(chunk, 'choices') and chunk.choices:
                    delta = chunk.choices[0].delta
                    if hasattr(delta, 'content') and delta.content:
                        yield delta.content
                    elif hasattr(delta, 'tool_calls') and delta.tool_calls:
                        # 如果是工具调用，返回整个 delta
                        yield {"role": "assistant", "tool_calls": delta.tool_calls}
                elif hasattr(chunk, 'choices') and not chunk.choices:
                    # 处理空 choices 的情况
                    continue
        except Exception as e:
            # 处理可能的异常
            raise e

    async def astream(self, prompt: Union[str, List[Dict]], **kwargs) -> AsyncGenerator[Union[str, Dict], None]:
        """Stream the language model's response asynchronously."""
        async_gen = self._astream_generator(prompt, **kwargs)
        # 为了满足类型检查器的要求，我们需要返回一个协程
        # 但实际上我们直接返回异步生成器
        return async_gen

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

    def generate(self, prompt: Union[str, List[Dict]], **kwargs) -> str:
        """Generate text response from a simple prompt string.
        
        Args:
            prompt: The input prompt string
            **kwargs: Additional generation parameters
            
        Returns:
            Generated text content as string
        """
        response = self.invoke(prompt, **kwargs)
        return response.content

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "LiteLLMProvider":
        model = config.get("model")
        if not model:
            raise ValueError("Model must be specified in config")
        return cls(
            model=model,
            api_key=config.get("api_key"),
            base_url=config.get("base_url"),
            api_version=config.get("api_version"),
            timeout=config.get("timeout"),
            max_retries=config.get("max_retries"),
        )