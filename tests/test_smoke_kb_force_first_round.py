#!/usr/bin/env python3
"""Smoke test: KB "always" mode resolution for first-round forced tool_choice.

Weak function-calling models (e.g. qwen-plus) skip native tool calls under KB
questions, so under "always" mode the runtime forces knowledge_search on the
first round. This guards the session-override-vs-config resolution used to
decide whether to force.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _KB_FORCED_TOOL_CHOICE,
    _eager_knowledge_search_query,
    _kb_retrieval_always_mode,
)


def test_session_override_always_wins() -> None:
    session = SimpleNamespace(kb_retrieval_mode="always")
    assert _kb_retrieval_always_mode(session) is True


def test_session_override_auto_is_not_always() -> None:
    session = SimpleNamespace(kb_retrieval_mode="auto")
    assert _kb_retrieval_always_mode(session) is False


def test_forced_tool_choice_targets_knowledge_search() -> None:
    assert _KB_FORCED_TOOL_CHOICE["type"] == "function"
    assert _KB_FORCED_TOOL_CHOICE["function"]["name"] == "knowledge_search"


def test_eager_knowledge_search_query_uses_user_text() -> None:
    assert _eager_knowledge_search_query("查下知识库关于 AI 网关内容") == "查下知识库关于 AI 网关内容"


def test_eager_knowledge_search_query_fallback_when_empty() -> None:
    assert _eager_knowledge_search_query("   ") == "知识库检索"


def test_eager_knowledge_search_injects_reasoning_content(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module
    from agenticx.runtime.agent_runtime import _eager_knowledge_search_events

    async def _fake_dispatch(*_args, **_kwargs):
        return "kb-hit"

    async def _before_tool(*_a, **_k):
        return SimpleNamespace(blocked=False, reason="")

    class _Runtime:
        hooks = SimpleNamespace(run_before_tool_call=_before_tool)
        confirm_gate = None
        compactor = SimpleNamespace(micro_compact_tool_result=lambda _n, raw: raw)
        _tools_since_persist = 0

        def _maybe_mid_turn_persist(self) -> None:
            return None

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    session = SimpleNamespace(agent_messages=[], chat_history=[], _team_manager=None)
    messages: list = []

    async def _run() -> None:
        async for _evt in _eager_knowledge_search_events(
            runtime=_Runtime(),
            session=session,
            user_input="查网关",
            messages=messages,
            agent_id="meta",
            executed_tool_names=[],
            is_system_trigger=False,
            team_manager=None,
        ):
            pass

    asyncio.run(_run())
    assistant = next(row for row in messages if row.get("role") == "assistant")
    assert assistant.get("tool_calls")
    assert assistant.get("reasoning_content") == ""


def test_eager_knowledge_search_long_result_gets_observation(tmp_path, monkeypatch) -> None:
    import json
    from pathlib import Path

    from agenticx.runtime import agent_runtime as runtime_module
    from agenticx.runtime.agent_runtime import _eager_knowledge_search_events
    from agenticx.runtime.compactor import ContextCompactor
    from agenticx.runtime.tool_result_budget import OBSERVATION_PREFIX

    hits = {
        "ok": True,
        "hits": [
            {
                "text": "MIDDLE_KB_SENTINEL about the gateway",
                "source": {
                    "title": "gateway",
                    "document_id": "doc-gateway",
                    "chunk_index": 0,
                    "path": "kb/a.md",
                },
            }
        ],
        "padding": "K" * 9000,
    }
    raw = json.dumps(hits, ensure_ascii=False)

    async def _fake_dispatch(*_args, **_kwargs):
        return raw

    async def _before_tool(*_a, **_k):
        return SimpleNamespace(blocked=False, reason="")

    class _PassLLM:
        def invoke(self, *_args, **_kwargs):
            return SimpleNamespace(content="摘要")

    class _Runtime:
        hooks = SimpleNamespace(run_before_tool_call=_before_tool)
        confirm_gate = None
        compactor = ContextCompactor(_PassLLM())
        _tools_since_persist = 0

        def _maybe_mid_turn_persist(self) -> None:
            return None

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    session = SimpleNamespace(
        _session_id="sess-kb-obs-001",
        agent_messages=[],
        chat_history=[],
        _team_manager=None,
    )
    messages: list = []
    events = []

    async def _run() -> None:
        async for evt in _eager_knowledge_search_events(
            runtime=_Runtime(),
            session=session,
            user_input="查网关",
            messages=messages,
            agent_id="meta",
            executed_tool_names=[],
            is_system_trigger=False,
            team_manager=None,
        ):
            events.append(evt)

    asyncio.run(_run())
    tool_msg = next(row for row in messages if row.get("role") == "tool")
    assert OBSERVATION_PREFIX in str(tool_msg["content"])
    result_event = next(evt for evt in events if evt.type == "tool_result")
    assert OBSERVATION_PREFIX in str(result_event.data.get("result") or "")
    assert result_event.private_data["raw_result"] == raw
    structured = result_event.data.get("structured") or {}
    refs = structured.get("references") or structured.get("items") or structured
    dumped = json.dumps(structured, ensure_ascii=False)
    assert "MIDDLE_KB_SENTINEL" in dumped or "gateway" in dumped
