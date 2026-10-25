#!/usr/bin/env python3
"""Enterprise-gateway LLM factory for managed agent sessions.

Author: Damon Li
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, Generator, List, Optional, Union

from pydantic import Field, PrivateAttr

from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.managed.llm import LLMCallContext

TRACE_STAGE = "ma.session"


def gateway_headers(*, provider: str, context: LLMCallContext) -> dict[str, str]:
    """Static correlation headers the enterprise gateway reads."""
    headers = {
        "x-agenticx-provider": provider,
        "X-AgenticX-Trace-Id": context.session_id.lower(),
        "X-AgenticX-Trace-Stage": TRACE_STAGE,
        "X-AgenticX-Session-Id": context.session_id,
        "X-Agenticx-Agent-Id": context.agent_id,
        "X-AgenticX-Deployment-Id": f"ma-{context.agent_id}-v{context.agent_version}",
    }
    if context.thread_id:
        headers["X-AgenticX-Thread-Id"] = context.thread_id
    return headers


class GatewayLiteLLMProvider(LiteLLMProvider):
    """LiteLLMProvider that adds gateway headers and a per-request trace step."""

    gateway_headers: Dict[str, str] = Field(default_factory=dict)
    _step: int = PrivateAttr(default=0)
    _step_lock: Any = PrivateAttr(default_factory=threading.Lock)

    def __repr__(self) -> str:
        return f"GatewayLiteLLMProvider(model={self.model!r}, base_url={self.base_url!r})"

    def _inject(self, kwargs: Dict[str, Any]) -> None:
        with self._step_lock:
            self._step += 1
            step = self._step
        merged = dict(self.gateway_headers)
        merged["X-AgenticX-Trace-Step"] = str(step)
        extra = kwargs.get("extra_headers")
        if isinstance(extra, dict):
            merged.update(extra)
        kwargs["extra_headers"] = merged

    def invoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Any:
        self._inject(kwargs)
        return super().invoke(prompt, tools=tools, **kwargs)

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Any:
        self._inject(kwargs)
        return await super().ainvoke(prompt, tools=tools, **kwargs)

    def stream(
        self,
        prompt: Union[str, List[Dict]],
        **kwargs: Any,
    ) -> Generator[Union[str, Dict], None, None]:
        self._inject(kwargs)
        return super().stream(prompt, **kwargs)

    def stream_with_tools(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ) -> Generator[Any, None, None]:
        self._inject(kwargs)
        return super().stream_with_tools(prompt, tools=tools, **kwargs)

    async def _astream_generator(
        self,
        prompt: Union[str, List[Dict]],
        **kwargs: Any,
    ) -> AsyncGenerator[Union[str, Dict], None]:
        self._inject(kwargs)
        async for item in super()._astream_generator(prompt, **kwargs):
            yield item


@dataclass(frozen=True)
class GatewayLLMFactory:
    """LLMFactory that routes every call through the enterprise gateway."""

    base_url: str
    token: str
    timeout_seconds: float = 300.0

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> GatewayLiteLLMProvider:
        """Return a provider whose HTTP calls carry gateway correlation headers."""
        return GatewayLiteLLMProvider(
            model=f"openai/{model}",
            api_key=self.token,
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            max_retries=0,
            drop_params=True,
            gateway_headers=gateway_headers(provider=provider, context=context),
        )

    def __repr__(self) -> str:
        return f"GatewayLLMFactory(base_url={self.base_url!r})"


__all__ = [
    "TRACE_STAGE",
    "GatewayLLMFactory",
    "GatewayLiteLLMProvider",
    "gateway_headers",
]
