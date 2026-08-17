#!/usr/bin/env python3
"""Smoke tests: meta_direct progress answers stay honest.

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import (
    GroupChatRouter,
    GroupReply,
    IntentDecision,
    _is_progress_query,
)
from agenticx.runtime.harden_flags import group_meta_direct_tools_enabled


def _make_avatar(name: str, role: str = "专家") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router() -> GroupChatRouter:
    avatars = {
        "wen": _make_avatar("文策渊"),
        "cheng": _make_avatar("程基岩"),
        "lin": _make_avatar("林绘澄"),
        "you": _make_avatar("游承峰"),
    }
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )


def _make_session(*, history: list | None = None) -> MagicMock:
    sess = MagicMock()
    sess.session_id = "honesty-session"
    sess._session_id = "honesty-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = list(history or [])
    sess.__group_avatar_ids = ["wen", "cheng", "lin", "you"]
    return sess


def test_meta_direct_tools_flag_defaults_off() -> None:
    assert group_meta_direct_tools_enabled() is False


def test_is_progress_query_markers() -> None:
    assert _is_progress_query("干活了吗？") is True
    assert _is_progress_query("进展如何") is True
    assert _is_progress_query("怎么样了？") is True
    assert _is_progress_query("帮我写个 GDD") is False
    assert _is_progress_query("小番薯用粉色") is False


@pytest.mark.asyncio
async def test_meta_direct_prompt_injects_facts_before_dialogue() -> None:
    router = _make_router()
    captured: dict[str, str] = {}

    async def stub_llm(**kwargs):
        captured["prompt"] = str(kwargs.get("prompt") or "")
        return "还没开始。"

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(
        history=[
            {
                "role": "assistant",
                "content": "三线并行启动：文策渊/程基岩/林绘澄",
                "sender_id": "__meta__",
                "agent_id": "__meta__",
            }
        ]
    )
    context = GroupChatContext(session)
    await router._run_meta_project_manager_reply(
        base_session=session,
        context=context,
        group_name="游戏开发工作室",
        user_input="干活了吗？",
    )
    prompt = captured["prompt"]
    assert "群工作台事实" in prompt
    assert "不得当作进展复述" in prompt
    assert prompt.index("群工作台事实") < prompt.index("最近群聊上下文")


@pytest.mark.asyncio
async def test_zero_exec_progress_query_appends_code_fallback() -> None:
    router = _make_router()

    async def stub_intent(**kwargs):
        return IntentDecision(action="meta_direct", target_ids=[], reason="stub")

    async def stub_llm(**kwargs):
        return "三线都在推进：程基岩 Godot 原型已跑通"

    async def no_follow(**kwargs):
        if False:
            yield GroupReply("__meta__", "Near", "", "", True, event_type="group_skipped")

    router._analyze_intent = stub_intent  # type: ignore[assignment]
    router._call_llm_text = stub_llm  # type: ignore[assignment]
    router._project_h2a_fanout = lambda **kwargs: []  # type: ignore[assignment]
    router._emit_mention_follow_ups = no_follow  # type: ignore[assignment]

    session = _make_session()
    replies: list[GroupReply] = []
    async for ev in router.run_group_turn(
        base_session=session,
        group_id="group:test",
        group_name="游戏开发工作室",
        routing="intelligent",
        group_avatar_ids=["wen", "cheng", "lin", "you"],
        mentioned_avatar_ids=[],
        user_input="干活了吗？",
        quoted_content="",
        should_stop=lambda: False,
    ):
        if ev.event_type == "group_reply":
            replies.append(ev)

    assert replies
    assert "暂无实际执行记录" in replies[-1].content


@pytest.mark.asyncio
async def test_progress_query_with_tool_row_skips_fallback() -> None:
    router = _make_router()

    async def stub_intent(**kwargs):
        return IntentDecision(action="meta_direct", target_ids=[], reason="stub")

    async def stub_llm(**kwargs):
        return "程基岩刚跑完一次工具。"

    async def no_follow(**kwargs):
        if False:
            yield GroupReply("__meta__", "Near", "", "", True, event_type="group_skipped")

    router._analyze_intent = stub_intent  # type: ignore[assignment]
    router._call_llm_text = stub_llm  # type: ignore[assignment]
    router._project_h2a_fanout = lambda **kwargs: []  # type: ignore[assignment]
    router._emit_mention_follow_ups = no_follow  # type: ignore[assignment]

    session = _make_session(
        history=[
            {
                "role": "tool",
                "content": "ok",
                "agent_id": "cheng",
                "sender_id": "cheng",
            }
        ]
    )
    replies: list[GroupReply] = []
    async for ev in router.run_group_turn(
        base_session=session,
        group_id="group:test",
        group_name="游戏开发工作室",
        routing="intelligent",
        group_avatar_ids=["wen", "cheng", "lin", "you"],
        mentioned_avatar_ids=[],
        user_input="干活了吗？",
        quoted_content="",
        should_stop=lambda: False,
    ):
        if ev.event_type == "group_reply":
            replies.append(ev)

    assert replies
    assert "暂无实际执行记录" not in replies[-1].content
