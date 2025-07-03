from typing import Any, AsyncGenerator, Generator, Union, Dict, List
import litellm

from .base import BaseLLMProvider
from .response import LLMResponse, TokenUsage, LLMChoice

class LiteLLMProvider(BaseLLMProvider):
    """
    An LLM provider that uses the LiteLLM library to interface with various models.
    This provider can be used for OpenAI, Anthropic, Ollama, and any other
    provider supported by LiteLLM.
    """

    def _prepare_messages(self, prompt: str) -> List[Dict[str, str]]:
        """Prepares the message format for LiteLLM."""
        # This can be extended to support more complex chat history and roles.
        return [{"role": "user", "content": prompt}]

    def _parse_response(self, response: litellm.ModelResponse) -> LLMResponse:
        """Parses a LiteLLM ModelResponse into an AgenticX LLMResponse."""
        usage = response.usage or {}
        token_usage = TokenUsage(
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0)
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
        if hasattr(response, 'cost') and response.cost:
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

    def invoke(self, prompt: str, **kwargs: Any) -> LLMResponse:
        """Invoke the language model synchronously."""
        messages = self._prepare_messages(prompt)
        response = litellm.completion(
            model=self.model,
            messages=messages,
            **kwargs
        )
        return self._parse_response(response)

    async def ainvoke(self, prompt: str, **kwargs: Any) -> LLMResponse:
        """Invoke the language model asynchronously."""
        messages = self._prepare_messages(prompt)
        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            **kwargs
        )
        return self._parse_response(response)

    def stream(self, prompt: str, **kwargs: Any) -> Generator[str, None, None]:
        """Stream the language model's response synchronously."""
        messages = self._prepare_messages(prompt)
        response_stream = litellm.completion(
            model=self.model,
            messages=messages,
            stream=True,
            **kwargs
        )
        for chunk in response_stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    async def astream(self, prompt: str, **kwargs: Any) -> AsyncGenerator[str, None]:
        """Stream the language model's response asynchronously."""
        messages = self._prepare_messages(prompt)
        response_stream = await litellm.acompletion(
            model=self.model,
            messages=messages,
            stream=True,
            **kwargs
        )
        async for chunk in response_stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content 