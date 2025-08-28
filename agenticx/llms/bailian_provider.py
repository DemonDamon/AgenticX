from typing import Any, Optional, Dict, List, AsyncGenerator, Generator
import openai
from pydantic import Field
from .base import BaseLLMProvider
from .response import LLMResponse, TokenUsage, LLMChoice

class BailianProvider(BaseLLMProvider):
    """
    Bailian (Dashscope) LLM provider that uses OpenAI-compatible API.
    Supports the latest Bailian models through Aliyun's API.
    """
    
    api_key: str = Field(description="Bailian API key")
    base_url: str = Field(default="https://dashscope.aliyuncs.com/compatible-mode/v1", description="Bailian API base URL")
    timeout: Optional[float] = Field(default=60.0, description="Request timeout in seconds")
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
        """Invoke the Bailian model synchronously."""
        try:
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                **kwargs
            }
            
            if tools:
                request_params["tools"] = tools
            
            response = self.client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Bailian API call failed: {str(e)}")
    
    async def ainvoke(
        self, messages: List[Dict], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Bailian model asynchronously."""
        try:
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
                **kwargs
            }
            
            if tools:
                request_params["tools"] = tools
            
            response = await async_client.chat.completions.create(**request_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Bailian API async call failed: {str(e)}")
    
    def stream(self, messages: List[Dict], **kwargs) -> Generator[str, None, None]:
        """Stream the Bailian model's response synchronously."""
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
            raise Exception(f"Bailian API stream call failed: {str(e)}")
    
    async def astream(self, messages: List[Dict], **kwargs) -> AsyncGenerator[str, None]:
        """Stream the Bailian model's response asynchronously."""
        try:
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
            raise Exception(f"Bailian API async stream call failed: {str(e)}")
    
    def _parse_response(self, response) -> LLMResponse:
        """Parse OpenAI response into AgenticX LLMResponse format."""
        usage = response.usage
        token_usage = TokenUsage(
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0
        )
        
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
            cost=None,
            metadata={
                "provider": "bailian",
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
        messages = [{"role": "user", "content": prompt}]
        response = self.invoke(messages, **kwargs)
        return response.content

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "BailianProvider":
        """Create BailianProvider from configuration dictionary."""
        return cls(
            model=config.get("model", "qwen-plus"),
            api_key=config.get("api_key"),
            base_url=config.get("base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
            timeout=config.get("timeout", 60.0),
            max_retries=config.get("max_retries", 3),
            temperature=config.get("temperature", 0.6)
        )

    def create_multimodal_message(self, text: str, image_url: Optional[str] = None, 
                                image_base64: Optional[str] = None) -> Dict:
        """创建多模态消息格式
        
        Args:
            text: 文本内容
            image_url: 图片URL（可选）
            image_base64: Base64编码的图片（可选）
            
        Returns:
            格式化的多模态消息
        """
        content = [{"type": "text", "text": text}]
        
        if image_url:
            content.append({
                "type": "image_url",
                "image_url": {"url": image_url}
            })
        elif image_base64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
            })
            
        return {"role": "user", "content": content}