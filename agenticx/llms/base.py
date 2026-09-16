from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Generator, Union, Dict, List, TypedDict, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict  # type: ignore

from .response import LLMResponse


class StreamChunk(TypedDict, total=False):
    type: Literal["content", "tool_call_delta", "usage", "done"]
    text: str
    tool_index: int
    tool_call_id: str
    tool_name: str
    arguments_delta: str
    usage: Dict[str, int]
    finish_reason: str


class BaseLLMProvider(ABC, BaseModel):
    """
    Abstract base class for all LLM providers in the AgenticX framework.
    """
    model: str = Field(description="The model name to use for the provider.")

    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    @abstractmethod
    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """
        Invoke the language model synchronously.
        
        Args:
            prompt: The input prompt for the model.
            **kwargs: Additional provider-specific arguments.
            
        Returns:
            An LLMResponse object with the model's output.
        """
        pass

    @abstractmethod
    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """
        Invoke the language model asynchronously.

        Args:
            prompt: The input prompt for the model.
            **kwargs: Additional provider-specific arguments.

        Returns:
            An LLMResponse object with the model's output.
        """
        pass

    @abstractmethod
    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        """
        Stream the language model's response synchronously.
        
        Yields:
            Chunks of the response, typically strings.
        """
        pass

    def stream_with_tools(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Generator[StreamChunk, None, None]:
        """
        Stream model output with tool-call deltas.

        Yields:
            StreamChunk objects including text deltas and tool_call deltas.
        """
        raise NotImplementedError("stream_with_tools is not implemented for this provider")

    @abstractmethod
    def astream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> AsyncGenerator[Union[str, Dict], None]:
        """
        Stream the language model's response asynchronously.

        实现要么本身是异步生成器（内部 yield），要么返回一个异步生成器——**不要**写成
        `async def` 再 `return` 生成器：那样调用方拿到的是协程，`async for` 会直接
        TypeError。Ark/Bailian/Failover 是前者，其余是后者，两种都满足这个签名。

        Yields:
            Chunks of the response, typically strings.
        """
        ...

    def supports_auth_profile_rotation(self) -> bool:
        """Whether this provider can receive per-call rotated credentials."""
        return True

    def invoke_with_profile(
        self,
        prompt: Union[str, List[Dict]],
        api_key: str,
        **kwargs: Any,
    ) -> LLMResponse:
        """Invoke with a rotated API key."""
        return self.invoke(prompt, api_key=api_key, **kwargs)