#!/usr/bin/env python3
"""Customer Desktop local-knowledge feature switch tests.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.cli.agent_tools import without_local_knowledge_tools
from agenticx.features import local_knowledge_enabled
from agenticx.runtime.agent_runtime import _kb_retrieval_always_mode
from agenticx.runtime.prompts.meta_agent import _build_kb_retrieval_policy_block


def _tool(name: str) -> dict:
    return {"type": "function", "function": {"name": name}}


def test_local_knowledge_defaults_to_enabled(monkeypatch) -> None:
    monkeypatch.delenv("AGX_LOCAL_KNOWLEDGE_ENABLED", raising=False)
    assert local_knowledge_enabled() is True


def test_disabled_flag_removes_only_local_knowledge_tools(monkeypatch) -> None:
    monkeypatch.setenv("AGX_LOCAL_KNOWLEDGE_ENABLED", "0")
    tools = [
        _tool("file_read"),
        _tool("knowledge_search"),
        _tool("knowledge_synthesize"),
        _tool("web_search"),
    ]

    assert [tool["function"]["name"] for tool in without_local_knowledge_tools(tools)] == [
        "file_read",
        "web_search",
    ]
    assert _build_kb_retrieval_policy_block("always") == ""
    assert _kb_retrieval_always_mode(SimpleNamespace(kb_retrieval_mode="always")) is False
