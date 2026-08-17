#!/usr/bin/env python3
"""Smoke test: KB "always" mode resolution for first-round forced tool_choice.

Weak function-calling models (e.g. qwen-plus) skip native tool calls under KB
questions, so under "always" mode the runtime forces knowledge_search on the
first round. This guards the session-override-vs-config resolution used to
decide whether to force.

Author: Damon Li
"""

from __future__ import annotations

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
    import asyncio
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
