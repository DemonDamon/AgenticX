from __future__ import annotations

import json

from agenticx.cli import agent_tools


def test_knowledge_search_returns_structured_config_error(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_tools,
        "_read_knowledge_config_for_tool",
        lambda: (None, "knowledge base unavailable: unknown brain_id: default_docs"),
    )

    result = json.loads(agent_tools._tool_knowledge_search({"query": "hello"}))

    assert result == {
        "ok": False,
        "error": "knowledge base unavailable: unknown brain_id: default_docs",
        "hits": [],
    }


def test_knowledge_synthesize_returns_structured_config_error(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_tools,
        "_read_knowledge_config_for_tool",
        lambda: (None, "knowledge base unavailable: unknown brain_id: default_docs"),
    )

    result = json.loads(agent_tools._tool_knowledge_synthesize({"query": "hello"}))

    assert result == {
        "ok": False,
        "error": "knowledge base unavailable: unknown brain_id: default_docs",
        "answer": "",
    }
