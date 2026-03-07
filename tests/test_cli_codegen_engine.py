#!/usr/bin/env python3
"""Tests for AGX code generation engine.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict, Generator, List, Union

from agenticx.cli.codegen_engine import CodeGenEngine
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage


class _FakeProvider(BaseLLMProvider):
    model: str = "fake-model"

    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        code = """```python
from agenticx import Agent, Task

def build():
    return Agent(
        id="demo",
        name="Demo",
        role="assistant",
        goal="help",
        organization_id="default"
    )
```"""
        return LLMResponse(
            id="fake-1",
            model_name=self.model,
            created=0,
            content=code,
            choices=[LLMChoice(index=0, content=code, finish_reason="stop")],
            token_usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        return self.invoke(prompt, **kwargs)

    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        yield "fake"

    async def astream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> AsyncGenerator[Union[str, Dict], None]:
        yield "fake"


def test_codegen_engine_generates_agent_code():
    engine = CodeGenEngine(provider=_FakeProvider(model="fake-model"))
    generated = engine.generate("agent", "Build a demo assistant", context={})
    assert "from agenticx import Agent, Task" in generated.code
    assert generated.target == "agent"
    assert generated.skill_name == "agenticx-agent-builder"
