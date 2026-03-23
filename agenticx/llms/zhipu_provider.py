#!/usr/bin/env python3
"""Zhipu (GLM) provider using OpenAI-compatible API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict, List, Optional, Union

from .litellm_provider import LiteLLMProvider


def _normalize_litellm_model_for_bigmodel(raw_model: str) -> str:
    """Map config or UI model ids to LiteLLM OpenAI-compatible BigModel routes.

    UI and configs often store ``zhipu/glm-5``; LiteLLM must use ``openai/<model_id>``
    with ``base_url`` pointing at ``open.bigmodel.cn`` so requests hit the
    OpenAI-compatible API. A bare ``zhipu/`` prefix is not a stable LiteLLM route
    across versions and can cause BadRequest or provider resolution errors.
    """
    name = str(raw_model).strip() if raw_model else "glm-4-plus"
    if not name:
        name = "glm-4-plus"
    if "/" in name:
        prefix, rest = name.split("/", 1)
        if prefix.lower() in ("zhipu", "openai"):
            name = rest.strip()
    if not name:
        name = "glm-4-plus"
    if name.lower().startswith("openai/"):
        return name
    return f"openai/{name}"


class ZhipuProvider(LiteLLMProvider):
    """LLM provider for Zhipu GLM models."""

    @classmethod
    def from_config(cls, config: Dict[str, Any]) -> "ZhipuProvider":
        raw_model = str(config.get("model", "glm-4-plus"))
        model = _normalize_litellm_model_for_bigmodel(raw_model)
        return cls(
            model=model,
            api_key=config.get("api_key"),
            base_url=config.get("base_url") or "https://open.bigmodel.cn/api/paas/v4",
            timeout=config.get("timeout", 45.0),
            max_retries=config.get("max_retries", 1),
        )

    def _with_zhipu_litellm_defaults(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Prefer dropping unsupported OpenAI fields BigModel rejects (e.g. parallel_tool_calls)."""
        merged = dict(kwargs)
        merged.setdefault("drop_params", True)
        return merged

    def invoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ):
        return super().invoke(prompt, tools=tools, **self._with_zhipu_litellm_defaults(kwargs))

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ):
        return await super().ainvoke(
            prompt, tools=tools, **self._with_zhipu_litellm_defaults(kwargs)
        )

    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any):
        return super().stream(prompt, **self._with_zhipu_litellm_defaults(kwargs))

    def stream_with_tools(
        self,
        prompt: Union[str, List[Dict]],
        tools: Optional[List[Dict]] = None,
        **kwargs: Any,
    ):
        return super().stream_with_tools(
            prompt, tools=tools, **self._with_zhipu_litellm_defaults(kwargs)
        )

    async def astream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> AsyncGenerator[Union[str, Dict], None]:
        return await super().astream(
            prompt, **self._with_zhipu_litellm_defaults(kwargs)
        )
