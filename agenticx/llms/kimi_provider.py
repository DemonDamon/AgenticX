import re
from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union

import openai  # type: ignore
from pydantic import Field  # type: ignore

from agenticx.llms.base import BaseLLMProvider, StreamChunk
from agenticx.llms.response import LLMResponse, TokenUsage, LLMChoice

_REDACTED_THINKING_BLOCK = re.compile(
    r"<think>\s*(.*?)\s*</think>",
    re.DOTALL | re.IGNORECASE,
)

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

    def _is_k2_series_model(self) -> bool:
        """Return True if current model is Kimi K2.5/K2.6 series."""
        model_name = (self.model or "").lower().split("/")[-1]
        return model_name.startswith("kimi-k2.6") or model_name.startswith("kimi-k2.5")

    @staticmethod
    def _extract_thinking_type(kwargs: Dict[str, Any]) -> Optional[str]:
        """Extract thinking.type from direct params or extra_body."""
        thinking = kwargs.get("thinking")
        if isinstance(thinking, dict):
            thinking_type = thinking.get("type")
            if isinstance(thinking_type, str):
                return thinking_type.lower()

        extra_body = kwargs.get("extra_body")
        if isinstance(extra_body, dict):
            extra_thinking = extra_body.get("thinking")
            if isinstance(extra_thinking, dict):
                thinking_type = extra_thinking.get("type")
                if isinstance(thinking_type, str):
                    return thinking_type.lower()
        return None

    def _resolve_temperature(self, kwargs: Dict[str, Any]) -> Optional[float]:
        """Resolve temperature with K2.x model constraints."""
        user_temperature = kwargs.get("temperature", self.temperature)
        if not self._is_k2_series_model():
            return user_temperature

        thinking_type = self._extract_thinking_type(kwargs)
        if thinking_type == "disabled":
            return 0.6
        return 1.0

    @staticmethod
    def _compose_content_with_reasoning(
        content: Optional[str], reasoning_content: Optional[str]
    ) -> str:
        """Compose content text with optional reasoning into think-tag format."""
        reasoning_text = str(reasoning_content or "").strip()
        response_text = str(content or "").strip()
        if reasoning_text and response_text:
            return f"<think>{reasoning_text}</think>\n{response_text}"
        if reasoning_text:
            return f"<think>{reasoning_text}</think>"
        return response_text

    def _should_patch_reasoning_content_for_tool_calls(self, kwargs: Dict[str, Any]) -> bool:
        """Kimi K2.x with thinking enabled requires reasoning_content on assistant tool_calls rows."""
        if self._extract_thinking_type(kwargs) == "disabled":
            return False
        return self._is_k2_series_model()

    @staticmethod
    def _fill_reasoning_content_for_tool_call_messages(
        messages: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Ensure each assistant+tool_calls message has reasoning_content for Moonshot validation."""
        out: List[Dict[str, Any]] = []
        for msg in messages:
            if not isinstance(msg, dict):
                out.append(msg)
                continue
            if str(msg.get("role")) != "assistant":
                out.append(msg)
                continue
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                out.append(msg)
                continue

            rc_existing = msg.get("reasoning_content")
            if rc_existing is not None and str(rc_existing).strip():
                out.append(msg)
                continue

            patched = dict(msg)
            content = patched.get("content")
            content_str = content if isinstance(content, str) else ""
            if content_str:
                match = _REDACTED_THINKING_BLOCK.search(content_str)
                if match:
                    reasoning = (match.group(1) or "").strip()
                    stripped = _REDACTED_THINKING_BLOCK.sub("", content_str).strip()
                    patched["reasoning_content"] = reasoning if reasoning else " "
                    patched["content"] = stripped if stripped else None
                else:
                    patched["reasoning_content"] = " "
            else:
                patched["reasoning_content"] = " "
            out.append(patched)
        return out

    def _prepare_request_messages(
        self, messages: List[Dict[str, Any]], kwargs: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        if not self._should_patch_reasoning_content_for_tool_calls(kwargs):
            return messages
        return self._fill_reasoning_content_for_tool_call_messages(messages)
    
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

            messages = self._prepare_request_messages(messages, kwargs)
            
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": self._resolve_temperature(kwargs),
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

            messages = self._prepare_request_messages(messages, kwargs)
            
            # 准备请求参数
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": self._resolve_temperature(kwargs),
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

            messages = self._prepare_request_messages(messages, kwargs)
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": self._resolve_temperature(kwargs),
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

            messages = self._prepare_request_messages(messages, kwargs)
            
            request_params = {
                "model": self.model,
                "messages": messages,
                "temperature": self._resolve_temperature(kwargs),
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

    def stream_with_tools(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Generator[StreamChunk, None, None]:
        """Stream content and tool-call deltas in normalized chunk format."""
        messages = self._convert_prompt_to_messages(prompt)
        if not self.client:
            self.client = openai.OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries or 3,
            )

        messages = self._prepare_request_messages(messages, kwargs)

        request_params = {
            "model": self.model,
            "messages": messages,
            "temperature": self._resolve_temperature(kwargs),
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "stream": True,
            **{
                k: v
                for k, v in kwargs.items()
                if k not in ["temperature", "max_tokens", "stream"]
            },
        }
        if tools:
            request_params["tools"] = tools

        response_stream = self.client.chat.completions.create(**request_params)
        reasoning_started = False
        reasoning_closed = False
        last_finish_reason = ""

        for chunk in response_stream:
            usage = getattr(chunk, "usage", None)
            if usage:
                prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
                total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
                if total_tokens == 0 and (prompt_tokens > 0 or completion_tokens > 0):
                    total_tokens = prompt_tokens + completion_tokens
                if prompt_tokens > 0 or completion_tokens > 0 or total_tokens > 0:
                    yield {
                        "type": "usage",
                        "usage": {
                            "prompt_tokens": prompt_tokens,
                            "completion_tokens": completion_tokens,
                            "total_tokens": total_tokens,
                        },
                    }

            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            choice0 = choices[0]
            finish_reason = getattr(choice0, "finish_reason", None)
            if isinstance(finish_reason, str) and finish_reason:
                last_finish_reason = finish_reason
            delta = getattr(choice0, "delta", None)
            if delta is None:
                continue

            reasoning_delta = getattr(delta, "reasoning_content", None)
            if isinstance(reasoning_delta, str) and reasoning_delta:
                if not reasoning_started:
                    reasoning_started = True
                    yield {"type": "content", "text": "<think>"}
                yield {"type": "content", "text": reasoning_delta}

            content_delta = getattr(delta, "content", None)
            if isinstance(content_delta, str) and content_delta:
                if reasoning_started and not reasoning_closed:
                    reasoning_closed = True
                    yield {"type": "content", "text": "</think>\n"}
                yield {"type": "content", "text": content_delta}

            tool_calls = getattr(delta, "tool_calls", None)
            if tool_calls:
                for tc in tool_calls:
                    raw_index = getattr(tc, "index", 0)
                    tool_index = int(raw_index) if isinstance(raw_index, int) else 0
                    tool_call_id = str(getattr(tc, "id", "") or "")
                    fn = getattr(tc, "function", None)
                    tool_name = ""
                    arguments_delta = ""
                    if fn is not None:
                        tool_name = str(getattr(fn, "name", "") or "")
                        arguments_delta = str(getattr(fn, "arguments", "") or "")
                    if tool_name.lower() == "none":
                        tool_name = ""
                    yield {
                        "type": "tool_call_delta",
                        "tool_index": tool_index,
                        "tool_call_id": tool_call_id,
                        "tool_name": tool_name,
                        "arguments_delta": arguments_delta,
                    }

        if reasoning_started and not reasoning_closed:
            yield {"type": "content", "text": "</think>"}
        yield {"type": "done", "finish_reason": last_finish_reason}
    
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
                content=self._compose_content_with_reasoning(
                    getattr(choice.message, "content", ""),
                    getattr(choice.message, "reasoning_content", ""),
                ),
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