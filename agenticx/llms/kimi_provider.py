from typing import Any, Optional, Dict, List, AsyncGenerator, Generator
import openai
from pydantic import Field
from .base import BaseLLMProvider
from .response import LLMResponse, TokenUsage, LLMChoice

class KimiProvider(BaseLLMProvider):
    """
    Kimi (Moonshot AI) LLM provider that uses OpenAI-compatible API.
    Supports the latest Kimi-K2 models through Moonshot AI's API.
    """
    
    api_key: str = Field(description="Moonshot API key")
    base_url: str = Field(default="https://api.moonshot.cn/v1", description="Moonshot API base URL")
    timeout: Optional[float] = Field(default=30.0, description="Request timeout in seconds")
    max_retries: Optional[int] = Field(default=3, description="Maximum number of retries")
    temperature: Optional[float] = Field(default=0.6, description="Sampling temperature")
    client: Optional[Any] = Field(default=None, exclude=True, description="OpenAI client instance")
    
    def __init__(self, **data):
        super().__init__(**data)
        self.client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries
        )
    
    def invoke(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Kimi model synchronously."""
        try:
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                **kwargs
            }
            
            # 如果提供了工具，添加到请求中
            if tools:
                request_params["tools"] = tools
            
            response = self.client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Kimi API调用失败: {str(e)}")
    
    async def ainvoke(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Kimi model asynchronously."""
        try:
            # 创建异步客户端
            async_client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries
            )
            
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                **kwargs
            }
            
            # 如果提供了工具，添加到请求中
            if tools:
                request_params["tools"] = tools
            
            response = await async_client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Kimi API异步调用失败: {str(e)}")
    
    def stream(self, messages: List[Dict], **kwargs) -> Generator[str, None, None]:
        """Stream the Kimi model's response synchronously."""
        try:
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "stream": True,
                **kwargs
            }
            
            response_stream = self.client.chat.completions.create(**request_params)
            
            for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise Exception(f"Kimi API流式调用失败: {str(e)}")
    
    async def astream(self, messages: List[Dict], **kwargs) -> AsyncGenerator[str, None]:
        """Stream the Kimi model's response asynchronously."""
        try:
            # 创建异步客户端
            async_client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries
            )
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "stream": True,
                **kwargs
            }
            
            response_stream = await async_client.chat.completions.create(**request_params)
            
            async for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise Exception(f"Kimi API异步流式调用失败: {str(e)}")
    
    def _parse_response(self, response) -> LLMResponse:
        """Parse OpenAI response into AgenticX LLMResponse format."""
        # 处理token使用情况
        usage = response.usage
        token_usage = TokenUsage(
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0
        )
        
        # 处理选择
        choices = [
            LLMChoice(
                index=choice.index,
                content=choice.message.content or "",
                finish_reason=choice.finish_reason
            ) for choice in response.choices
        ]
        
        main_content = choices[0].content if choices else ""
        
        return LLMResponse(
            id=response.id,
            model_name=response.model,
            created=response.created,
            content=main_content,
            choices=choices,
            token_usage=token_usage,
            cost=None,  # Moonshot API暂不提供成本信息
            metadata={
                "provider": "moonshot",
                "api_version": "v1"
            }
        )
    
    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "KimiProvider":
        """Create KimiProvider from configuration dictionary."""
        return cls(
            model=config.get("model", "kimi-k2-0711-preview"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url", "https://api.moonshot.cn/v1"),
            timeout=config.get("timeout", 30.0),
            max_retries=config.get("max_retries", 3),
            temperature=config.get("temperature", 0.6)
        )