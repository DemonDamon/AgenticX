import asyncio
from typing import Any, Optional, Dict, List, AsyncGenerator, Generator, Union, cast
import litellm  # type: ignore
from pydantic import Field  # type: ignore
from .base import BaseLLMProvider, StreamChunk
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
    fallbacks: Optional[List[str]] = Field(default=None, description="List of fallback model names when primary model fails")

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
            
        timeout = kwargs.pop("timeout", self.timeout)
        max_retries = kwargs.pop("max_retries", self.max_retries)
        fallbacks = kwargs.pop("fallbacks", self.fallbacks)
        try:
            response = litellm.completion(
                model=self.model,
                messages=messages,
                tools=tools,
                api_key=self.api_key,
                base_url=self.base_url,
                api_version=self.api_version,
                timeout=timeout,
                max_retries=max_retries,
                fallbacks=fallbacks,
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
            
        timeout = kwargs.pop("timeout", self.timeout)
        max_retries = kwargs.pop("max_retries", self.max_retries)
        fallbacks = kwargs.pop("fallbacks", self.fallbacks)
        try:
            response = await litellm.acompletion(
                model=self.model,
                messages=messages,
                tools=tools,
                api_key=self.api_key,
                base_url=self.base_url,
                api_version=self.api_version,
                timeout=timeout,
                max_retries=max_retries,
                fallbacks=fallbacks,
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
            
        timeout = kwargs.pop("timeout", self.timeout)
        max_retries = kwargs.pop("max_retries", self.max_retries)
        fallbacks = kwargs.pop("fallbacks", self.fallbacks)
        response_stream = litellm.completion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            timeout=timeout,
            max_retries=max_retries,
            fallbacks=fallbacks,
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

    def stream_with_tools(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Generator[StreamChunk, None, None]:
        """Stream content/tool-call deltas in a normalized chunk format."""
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        elif isinstance(prompt, list):
            messages = prompt
        else:
            raise ValueError(f"Unsupported prompt type: {type(prompt)}")

        timeout = kwargs.pop("timeout", self.timeout)
        max_retries = kwargs.pop("max_retries", self.max_retries)
        fallbacks = kwargs.pop("fallbacks", self.fallbacks)
        response_stream = litellm.completion(
            model=self.model,
            messages=messages,
            tools=tools,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            timeout=timeout,
            max_retries=max_retries,
            fallbacks=fallbacks,
            **kwargs,
        )
        last_finish_reason = ""
        try:
            for chunk in response_stream:
                chunk = cast(Any, chunk)
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
                content = getattr(delta, "content", None)
                if isinstance(content, str) and content:
                    yield {"type": "content", "text": content}
                tool_calls = getattr(delta, "tool_calls", None)
                if tool_calls:
                    for tc in tool_calls:
                        tc_any = cast(Any, tc)
                        idx = getattr(tc_any, "index", 0)
                        tc_id = getattr(tc_any, "id", "") or ""
                        fn_obj = getattr(tc_any, "function", None)
                        raw_fn_name = getattr(fn_obj, "name", "") if fn_obj is not None else ""
                        fn_name = str(raw_fn_name) if isinstance(raw_fn_name, str) else ""
                        if fn_name.lower() == "none":
                            fn_name = ""
                        fn_args = getattr(fn_obj, "arguments", "") if fn_obj is not None else ""
                        yield {
                            "type": "tool_call_delta",
                            "tool_index": int(idx) if isinstance(idx, int) else 0,
                            "tool_call_id": str(tc_id),
                            "tool_name": fn_name,
                            "arguments_delta": str(fn_args),
                        }
            yield {"type": "done", "finish_reason": last_finish_reason}
        except Exception as e:
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
        timeout = kwargs.pop("timeout", self.timeout)
        max_retries = kwargs.pop("max_retries", self.max_retries)
        fallbacks = kwargs.pop("fallbacks", self.fallbacks)
        response_stream = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            api_version=self.api_version,
            timeout=timeout,
            max_retries=max_retries,
            fallbacks=fallbacks,
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

        # Extract tool_calls from the first choice's message
        raw_tool_calls = None
        if response.choices:
            msg = getattr(response.choices[0], "message", None)
            if msg is not None:
                tc_list = getattr(msg, "tool_calls", None)
                if tc_list:
                    raw_tool_calls = []
                    for tc in tc_list:
                        fn_obj = getattr(tc, "function", None)
                        raw_fn_name = getattr(fn_obj, "name", "") if fn_obj is not None else ""
                        fn_name = str(raw_fn_name) if isinstance(raw_fn_name, str) else ""
                        if fn_name.lower() == "none":
                            fn_name = ""
                        raw_tool_calls.append({
                            "id": getattr(tc, "id", ""),
                            "type": getattr(tc, "type", "function"),
                            "function": {
                                "name": fn_name,
                                "arguments": getattr(fn_obj, "arguments", "{}") if fn_obj is not None else "{}",
                            },
                        })

        # Safely retrieve cost information
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
            },
            tool_calls=raw_tool_calls,
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
            fallbacks=config.get("fallbacks"),
        )