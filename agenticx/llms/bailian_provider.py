from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union
import openai
import json
import requests
import aiohttp
from pydantic import Field
from loguru import logger
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
            max_retries=self.max_retries or 3
        )
    
    def _needs_native_request(self, model_name: str) -> bool:
        """检查是否需要使用原生HTTP请求（因为有百炼特有参数）"""
        model_lower = model_name.lower()
        return any(model in model_lower for model in ["qwen3-32b", "qwen3-8b", "qwen-plus", "qwen-turbo"])
    
    def _make_native_request(self, request_params: Dict[str, Any]) -> Any:
         """使用原生HTTP请求调用百炼API"""
         headers = {
             "Authorization": f"Bearer {self.api_key}",
             "Content-Type": "application/json"
         }
         
         # 添加百炼特有参数
         if self._needs_native_request(request_params.get("model", "")):
             request_params["enable_thinking"] = False
             logger.debug(f"为模型 {request_params.get('model')} 设置 enable_thinking=false")
         
         url = f"{self.base_url}/chat/completions"
         
         try:
             # 禁用代理以避免连接问题
             proxies = {
                 'http': None,
                 'https': None
             }
             
             response = requests.post(
                 url,
                 headers=headers,
                 json=request_params,
                 timeout=self.timeout,
                 proxies=proxies,
                 verify=True  # 保持SSL验证
             )
             response.raise_for_status()
             return response.json()
         except Exception as e:
             raise Exception(f"Native Bailian API call failed: {str(e)}")
    
    def _convert_native_response(self, response_data: Dict[str, Any]) -> Any:
         """将原生响应转换为OpenAI格式的对象"""
         # 创建一个简单的对象来模拟OpenAI响应格式
         class MockResponse:
             def __init__(self, data):
                 self.id = data.get('id', '')
                 self.model = data.get('model', '')
                 self.created = data.get('created', 0)
                 self.choices = []
                 self.usage = None
                 
                 # 处理choices
                 for choice_data in data.get('choices', []):
                     choice = type('Choice', (), {})()
                     choice.index = choice_data.get('index', 0)
                     choice.finish_reason = choice_data.get('finish_reason', '')
                     
                     # 处理message
                     message_data = choice_data.get('message', {})
                     message = type('Message', (), {})()
                     message.content = message_data.get('content', '')
                     message.role = message_data.get('role', 'assistant')
                     choice.message = message
                     
                     self.choices.append(choice)
                 
                 # 处理usage
                 usage_data = data.get('usage', {})
                 if usage_data:
                     usage = type('Usage', (), {})()
                     usage.prompt_tokens = usage_data.get('prompt_tokens', 0)
                     usage.completion_tokens = usage_data.get('completion_tokens', 0)
                     usage.total_tokens = usage_data.get('total_tokens', 0)
                     self.usage = usage
         
         return MockResponse(response_data)
     
    def _prepare_bailian_params(self, request_params: Dict[str, Any]) -> Dict[str, Any]:
         """处理百炼特定的参数，确保与OpenAI客户端兼容"""
         # 创建参数副本
         params = request_params.copy()
         
         # 如果需要百炼特有参数，不在这里添加，而是在调用时判断使用原生请求
         return params
    
    def invoke(
        self, prompt: Union[str, List[Dict]], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Bailian model synchronously."""
        try:
            # Convert prompt to messages format
            if isinstance(prompt, str):
                messages = [{"role": "user", "content": prompt}]
            elif isinstance(prompt, list):
                messages = prompt
            else:
                raise ValueError("Prompt must be either a string or a list of message dictionaries")
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                **kwargs
            }
            
            if tools:
                request_params["tools"] = tools
            
            # 记录请求详情
            logger.info(f"发送请求到百炼API: 模型={self.model}, 温度={request_params.get('temperature', self.temperature)}, 消息数={len(messages)}")
            
            # 记录消息内容（截断长消息）
            for i, msg in enumerate(messages):
                content = msg.get('content', '')
                if isinstance(content, str):
                    content_preview = content[:200] + "..." if len(content) > 200 else content
                    logger.debug(f"📨 消息[{i}] ({msg.get('role', 'unknown')}): {content_preview}")
                else:
                    logger.debug(f"📨 消息[{i}] ({msg.get('role', 'unknown')}): [复杂内容]")
            
            if tools:
                logger.debug(f"工具数量: {len(tools)}")
            
            # 检查是否需要使用原生HTTP请求
            if self._needs_native_request(self.model):
                logger.debug("使用原生HTTP请求调用百炼API")
                response_data = self._make_native_request(request_params)
                # 将原生响应转换为OpenAI格式的对象
                response = self._convert_native_response(response_data)
            else:
                # 使用OpenAI客户端
                final_params = self._prepare_bailian_params(request_params)
                logger.trace(f"完整请求参数: {json.dumps(final_params, ensure_ascii=False, indent=2)}")
                
                if self.client is None:
                    raise ValueError("Client not initialized")
                
                logger.debug(f"正在调用百炼API: 参数={list(final_params.keys())}")
                response = self.client.chat.completions.create(**final_params)
            
            # 记录响应详情
            logger.info("✅ 百炼API响应成功")
            if hasattr(response, 'usage') and response.usage:
                logger.debug(f"Token使用: 输入={response.usage.prompt_tokens}, 输出={response.usage.completion_tokens}, 总计={response.usage.total_tokens}")
            
            if hasattr(response, 'choices') and response.choices:
                choice = response.choices[0]
                if hasattr(choice, 'message') and choice.message:
                    content = choice.message.content or ""
                    content_preview = content[:300] + "..." if len(content) > 300 else content
                    logger.debug(f"响应内容: {len(content)}字符 - {content_preview}")
            
            # 记录完整响应（trace级别）
            logger.trace(f"完整API响应: {response}")
            
            parsed_response = self._parse_response(response)
            logger.debug(f"✨ 响应解析完成")
            return parsed_response
        except Exception as e:
            logger.error(f"❌ 百炼API调用失败: {str(e)}")
            raise Exception(f"Bailian API call failed: {str(e)}")
    
    async def ainvoke(
        self, prompt: Union[str, List[Dict]], tools: Optional[List[Dict]] = None, **kwargs
    ) -> LLMResponse:
        """Invoke the Bailian model asynchronously."""
        try:
            # Convert prompt to messages format
            if isinstance(prompt, str):
                messages = [{"role": "user", "content": prompt}]
            elif isinstance(prompt, list):
                messages = prompt
            else:
                raise ValueError("Prompt must be either a string or a list of message dictionaries")
            
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
                **kwargs
            }
            
            if tools:
                request_params["tools"] = tools
            
            # 处理百炼特定参数
            final_params = self._prepare_bailian_params(request_params)
            
            response = await async_client.chat.completions.create(**final_params)
            return self._parse_response(response)
        except Exception as e:
            raise Exception(f"Bailian API async call failed: {str(e)}")
    
    def stream(self, prompt: Union[str, List[Dict]], **kwargs) -> Generator[str, None, None]:
        """Stream the Bailian model's response synchronously."""
        try:
            # Convert prompt to messages format
            if isinstance(prompt, str):
                messages = [{"role": "user", "content": prompt}]
            elif isinstance(prompt, list):
                messages = prompt
            else:
                raise ValueError("Prompt must be either a string or a list of message dictionaries")
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": kwargs.get("temperature", self.temperature),
                "stream": True,
                **kwargs
            }
            
            if self.client is None:
                raise ValueError("Client not initialized")
                
            response_stream = self.client.chat.completions.create(**request_params)
            
            for chunk in response_stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise Exception(f"Bailian API stream call failed: {str(e)}")
    
    async def astream(self, prompt: Union[str, List[Dict]], **kwargs):  # type: ignore
        """Stream the Bailian model's response asynchronously."""
        try:
            # Convert prompt to messages format
            if isinstance(prompt, str):
                messages = [{"role": "user", "content": prompt}]
            elif isinstance(prompt, list):
                messages = prompt
            else:
                raise ValueError("Prompt must be either a string or a list of message dictionaries")
            
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
        response = self.invoke(prompt, **kwargs)
        return response.content

    def call(self, prompt: Union[str, List[Dict]], **kwargs) -> str:
        """Call method for compatibility with extractors.
        
        Args:
            prompt: The input prompt
            **kwargs: Additional parameters
            
        Returns:
            Generated text content as string
        """
        logger.debug("🔄 调用call方法（兼容性接口）")
        response = self.invoke(prompt, **kwargs)
        logger.debug(f"📤 返回文本内容，长度: {len(response.content)} 字符")
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
        content: List[Dict[str, Any]] = [{"type": "text", "text": text}]
        
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