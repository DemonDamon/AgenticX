"""Smoke tests for knowledge search orchestration intent mode."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import pytest

from agenticx.knowledge.search_orchestration import (
    KnowledgeRecognitionMode,
    KnowledgeSearchOrchestrator,
)


@dataclass
class _FakeDoc:
    content: str


class _FakeKnowledge:
    def __init__(self) -> None:
        self.calls: List[dict] = []

    async def search(self, query: str, limit: int = 10, **kwargs):
        self.calls.append({"query": query, "limit": limit, "kwargs": kwargs})
        return [_FakeDoc(content=f"doc:{query}")]


class _FakeLLM:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: List[str] = []

    async def ainvoke(self, prompt):
        self.calls.append(str(prompt))
        return type("Resp", (), {"content": self.content})()


class _ErrorLLM:
    async def ainvoke(self, prompt):
        raise RuntimeError("llm down")


@pytest.mark.asyncio
async def test_force_mode_always_searches_without_llm() -> None:
    knowledge = _FakeKnowledge()
    llm = _FakeLLM("<need_search>false</need_search>")
    orchestrator = KnowledgeSearchOrchestrator(
        knowledge=knowledge,
        mode=KnowledgeRecognitionMode.FORCE,
        llm_provider=llm,
    )

    result = await orchestrator.search("hello", top_k=3)
    assert len(knowledge.calls) == 1
    assert knowledge.calls[0]["limit"] == 3
    assert result.intent_detected is True
    assert len(llm.calls) == 0


@pytest.mark.asyncio
async def test_intent_mode_true_triggers_search() -> None:
    knowledge = _FakeKnowledge()
    llm = _FakeLLM("<need_search>true</need_search>")
    orchestrator = KnowledgeSearchOrchestrator(
        knowledge=knowledge,
        mode=KnowledgeRecognitionMode.INTENT,
        llm_provider=llm,
    )

    result = await orchestrator.search("what is x")
    assert result.intent_detected is True
    assert len(result.documents) == 1
    assert len(knowledge.calls) == 1
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_intent_mode_false_skips_search() -> None:
    knowledge = _FakeKnowledge()
    llm = _FakeLLM("<need_search>false</need_search>")
    orchestrator = KnowledgeSearchOrchestrator(
        knowledge=knowledge,
        mode=KnowledgeRecognitionMode.INTENT,
        llm_provider=llm,
    )

    result = await orchestrator.search("chat only")
    assert result.intent_detected is False
    assert result.documents == []
    assert len(knowledge.calls) == 0
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_intent_mode_without_llm_falls_back_to_force() -> None:
    knowledge = _FakeKnowledge()
    orchestrator = KnowledgeSearchOrchestrator(
        knowledge=knowledge,
        mode=KnowledgeRecognitionMode.INTENT,
        llm_provider=None,
    )

    result = await orchestrator.search("fallback")
    assert result.mode == KnowledgeRecognitionMode.FORCE
    assert len(result.documents) == 1
    assert len(knowledge.calls) == 1


@pytest.mark.asyncio
async def test_intent_mode_llm_error_falls_back_to_force() -> None:
    knowledge = _FakeKnowledge()
    orchestrator = KnowledgeSearchOrchestrator(
        knowledge=knowledge,
        mode=KnowledgeRecognitionMode.INTENT,
        llm_provider=_ErrorLLM(),
    )

    result = await orchestrator.search("fallback-on-error")
    assert result.mode == KnowledgeRecognitionMode.FORCE
    assert len(result.documents) == 1
    assert len(knowledge.calls) == 1
