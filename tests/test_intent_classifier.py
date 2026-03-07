#!/usr/bin/env python3
"""Tests for studio intent classifier.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict, Generator, List, Union

from agenticx.cli.intent_classifier import IntentClassifier, IntentType
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage


class _IntentTokenProvider(BaseLLMProvider):
    model: str = "fake-model"

    def __init__(self, content: str, model: str = "fake-model") -> None:
        super().__init__(model=model)
        self._content = content

    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        content = self._content
        return LLMResponse(
            id="fake-intent",
            model_name=self.model,
            created=0,
            content=content,
            choices=[LLMChoice(index=0, content=content, finish_reason="stop")],
            token_usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        return self.invoke(prompt, **kwargs)

    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        yield "fake"

    async def astream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> AsyncGenerator[Union[str, Dict], None]:
        yield "fake"


def test_chat_intent_for_short_question() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("你是？") == IntentType.CHAT


def test_generate_intent_for_create_request() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("帮我创建一个Agent") == IntentType.GENERATE_CODE


def test_question_intent_for_how_to_create_agent() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("如何创建一个Agent？") == IntentType.QUESTION


def test_question_intent_for_why_modify_config() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("为什么要修改配置？") == IntentType.QUESTION


def test_modify_intent_for_incremental_change() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("加一个搜索工具") == IntentType.MODIFY_CODE


def test_question_intent_for_capability_question() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("AgenticX支持哪些LLM？") == IntentType.QUESTION


def test_unclear_intent_for_empty_input() -> None:
    classifier = IntentClassifier()
    assert classifier.classify_intent("") == IntentType.UNCLEAR


def test_llm_generate_code_token_maps_to_generate_code_intent() -> None:
    classifier = IntentClassifier(provider=_IntentTokenProvider(content="GENERATE_CODE"))
    assert classifier.classify_intent("请处理这个需求并返回意图") == IntentType.GENERATE_CODE
