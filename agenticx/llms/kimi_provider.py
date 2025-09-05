from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union
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
    max_tokens: Optional[int] = Field(default=32000, description="Maximum tokens to generate")
    client: Optional[Any] = Field(default=None, exclude=True, description="OpenAI client instance")
    
    def __init__(self, **data):
        super().__init__(**data)
        # 确保 client 被正确初始化
        if not self.client:
            self.client = openai.OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries or 3
            )
    
    def _convert_prompt_to_messages(self, prompt: Union[str, List[Dict]]) -> List[Dict]:
        """Convert a prompt string or messages list to messages format."""
        if isinstance(prompt, str):
            return [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            return prompt
        else:
            raise ValueError("Prompt must be either a string or a list of messages")
    
    def _invoke_with_messages(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Kimi model synchronously with messages."""
        try:
            # 确保 client 被初始化
            if not self.client:
                self.client = openai.OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url,
                    timeout=self.timeout,
                    max_retries=self.max_retries or 3
                )
            
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                **{k: v for k, v in kwargs.items() if k not in ["temperature", "max_tokens"]}
            }
            
            # 如果提供了工具，添加到请求中
            if tools:
                request_params["tools"] = tools
            
            response = self.client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Kimi API调用失败: {str(e)}")
    
    async def _ainvoke_with_messages(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Kimi model asynchronously with messages."""
        try:
            # 创建异步客户端
            async_client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries or 3
            )
            
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                **{k: v for k, v in kwargs.items() if k not in ["temperature", "max_tokens"]}
            }
            
            # 如果提供了工具，添加到请求中
            if tools:
                request_params["tools"] = tools
            
            response = await async_client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Kimi API异步调用失败: {str(e)}")
    
    def _stream_with_messages(self, messages: List[Dict], **kwargs) -> Generator[Union[str, Dict], None, None]:
        """Stream the Kimi model's response synchronously with messages."""
        try:
            # 确保 client 被初始化
            if not self.client:
                self.client = openai.OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url,
                    timeout=self.timeout,
                    max_retries=self.max_retries or 3
                )
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                "stream": True,
                **{k: v for k, v in kwargs.items() if k not in ["temperature", "max_tokens", "stream"]}
            }
            
            response_stream = self.client.chat.completions.create(**request_params)
            
            for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise Exception(f"Kimi API流式调用失败: {str(e)}")
    
    async def _astream_with_messages(self, messages: List[Dict], **kwargs) -> AsyncGenerator[Union[str, Dict], None]:
        """Stream the Kimi model's response asynchronously with messages."""
        try:
            # 创建异步客户端
            async_client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries or 3
            )
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                "stream": True,
                **{k: v for k, v in kwargs.items() if k not in ["temperature", "max_tokens", "stream"]}
            }
            
            response_stream = await async_client.chat.completions.create(**request_params)
            
            async for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise Exception(f"Kimi API异步流式调用失败: {str(e)}")
    
    # 基类要求的方法实现
    def invoke(self, prompt: Union[str, List[Dict]], **kwargs) -> LLMResponse:
        """Invoke the Kimi model synchronously."""
        messages = self._convert_prompt_to_messages(prompt)
        return self._invoke_with_messages(messages, **kwargs)
    
    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs) -> LLMResponse:
        """Invoke the Kimi model asynchronously."""
        messages = self._convert_prompt_to_messages(prompt)
        return await self._ainvoke_with_messages(messages, **kwargs)
    
    def stream(self, prompt: Union[str, List[Dict]], **kwargs) -> Generator[Union[str, Dict], None, None]:
        """Stream the Kimi model's response synchronously."""
        messages = self._convert_prompt_to_messages(prompt)
        return self._stream_with_messages(messages, **kwargs)
    
    async def astream(self, prompt: Union[str, List[Dict]], **kwargs) -> AsyncGenerator[Union[str, Dict], None]:
        """Stream the Kimi model's response asynchronously."""
        messages = self._convert_prompt_to_messages(prompt)
        async_gen = self._astream_with_messages(messages, **kwargs)
        # 为了满足类型检查器的要求，我们需要返回一个协程
        # 但实际上我们直接返回异步生成器
        return async_gen
    
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
    
    def generate(self, prompt: str, **kwargs) -> str:
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
    def from_config(cls, config: Dict[str, Any]) -> "KimiProvider":
        """Create KimiProvider from configuration dictionary."""
        return cls(
            model=config.get("model", "kimi-k2-0711-preview"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url", "https://api.moonshot.cn/v1"),
            timeout=config.get("timeout", 30.0),
            max_retries=config.get("max_retries", 3),
            temperature=config.get("temperature", 0.6),
            max_tokens=config.get("max_tokens", 32000)
        )