#!/usr/bin/env python3
"""Turn-intent plan filtering.

Author: Damon Li
"""

from types import SimpleNamespace

from agenticx.runtime.plan_mode import (
    apply_turn_intent_to_session,
    build_turn_intent_block,
    filter_tools_for_turn_intent,
    turn_intent_denial_message,
)


def _tool(name: str) -> dict:
    return {"type": "function", "function": {"name": name}}


TOOLS = [
    _tool("file_read"),
    _tool("file_write"),
    _tool("bash_exec"),
    _tool("delegate_to_avatar"),
    _tool("knowledge_search"),
]


def test_default_keeps_all_tools():
    session = SimpleNamespace()
    apply_turn_intent_to_session(session, plan_mode=False, is_automation=False)
    names = [t["function"]["name"] for t in filter_tools_for_turn_intent(TOOLS, session)]
    assert names == [t["function"]["name"] for t in TOOLS]


def test_plan_mode_strips_mutating_tools():
    session = SimpleNamespace()
    apply_turn_intent_to_session(session, plan_mode=True, is_automation=False)
    assert session.plan_mode is True
    names = [t["function"]["name"] for t in filter_tools_for_turn_intent(TOOLS, session)]
    assert "file_read" in names
    assert "knowledge_search" in names
    assert "file_write" not in names
    assert "bash_exec" not in names
    assert "delegate_to_avatar" not in names


def test_automation_ignores_turn_intent():
    session = SimpleNamespace()
    apply_turn_intent_to_session(session, plan_mode=True, is_automation=True)
    assert session.plan_mode is False
    names = [t["function"]["name"] for t in filter_tools_for_turn_intent(TOOLS, session)]
    assert "file_write" in names


def test_isolate_run_wins_over_plan_mode():
    session = SimpleNamespace(scratchpad={})
    apply_turn_intent_to_session(
        session,
        plan_mode=True,
        is_automation=False,
        isolate_run=True,
    )
    assert session.plan_mode is False


def test_dispatch_denial_and_prompt_blocks():
    session = SimpleNamespace()
    apply_turn_intent_to_session(session, plan_mode=True, is_automation=False)
    assert turn_intent_denial_message("file_read", session) is None
    denied = turn_intent_denial_message("file_write", session)
    assert denied is not None
    assert "file_write" in denied
    assert "Plan mode" in build_turn_intent_block(session)
    apply_turn_intent_to_session(session, plan_mode=False, is_automation=False)
    assert build_turn_intent_block(session) == ""
