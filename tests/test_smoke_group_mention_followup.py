#!/usr/bin/env python3
"""Smoke tests: member @ in a reply must wake the cited expert.

Near 在群里 @程基岩 派活时，即使该专家本轮已经回过一次，也必须再跑一轮
（否则侧栏会一直停在「已回复 N 次」、没有活动卡）。

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import (
    META_LEADER_AGENT_ID,
    GroupChatRouter,
    GroupReply,
    IntentDecision,
    _EXECUTION_TURN_INSTRUCTION,
    _cited_mention_requires_execution,
)


NEAR_ASSIGNMENT = (
    '@程基岩 你别等，自己先用 `grep -n "countdown\\|gameState\\|setInterval\\|setTimeout" '
    "fanshu_game.html` 把所有相关行拉出来贴群里，我同步读完整逻辑，两边对一下 5 分钟能定位。"
)


def _make_avatar(name: str, role: str = "成员") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router() -> GroupChatRouter:
    avatars = {
        "cheng": _make_avatar("程基岩", "引擎工程师"),
        "wen": _make_avatar("文策渊"),
    }
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
        meta_leader_display_name="Near",
    )
    router._project_h2a_fanout = MagicMock(return_value=[])  # type: ignore[assignment]
    router._project_a2a_message_edge = MagicMock(return_value=[])  # type: ignore[assignment]
    router._maybe_yield_debate_nudge = MagicMock(return_value=[])  # type: ignore[assignment]
    return router


def _make_session() -> MagicMock:
    sess = MagicMock()
    sess.session_id = "mention-followup-session"
    sess._session_id = "mention-followup-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = ["cheng", "wen"]
    return sess


def _reply(agent_id: str, content: str, *, event_type: str = "group_reply") -> GroupReply:
    return GroupReply(
        agent_id=agent_id,
        avatar_name=agent_id,
        avatar_url="",
        content=content,
        skipped=False,
        event_type=event_type,
    )


def test_assignment_with_inline_command_is_execution() -> None:
    assert _cited_mention_requires_execution(NEAR_ASSIGNMENT) is True
    assert _cited_mention_requires_execution("@程基岩 你怎么看这个方案") is False


def test_parses_near_assignment_mention() -> None:
    router = _make_router()
    targets = router._mention_targets_in_text(
        NEAR_ASSIGNMENT,
        speaker_id=META_LEADER_AGENT_ID,
        group_avatar_ids=["cheng", "wen"],
    )
    assert targets == ["cheng"]


@pytest.mark.asyncio
async def test_mention_hop_runs_even_if_member_already_replied_this_turn() -> None:
    router = _make_router()
    streamed: list[str] = []
    extras: list[str] = []

    async def _stub_stream(**kwargs):
        streamed.append(str(kwargs.get("avatar_id") or ""))
        extras.append(str(kwargs.get("extra_instruction") or ""))
        yield _reply("cheng", "countdown 在 128 行。")

    router._run_one_target_stream = _stub_stream  # type: ignore[assignment]
    session = _make_session()
    events: list[GroupReply] = []
    async for evt in router._emit_mention_follow_ups(
        reply=_reply(META_LEADER_AGENT_ID, NEAR_ASSIGNMENT),
        group_avatar_ids=["cheng", "wen"],
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Control Room",
        should_stop=lambda: False,
        user_display_name="我",
        hops=2,
        responded_this_turn={"cheng"},
    ):
        events.append(evt)

    assert streamed == ["cheng"]
    assert any(e.event_type == "group_typing" and e.agent_id == "cheng" for e in events)
    assert any(e.event_type == "group_reply" and e.agent_id == "cheng" for e in events)
    assert extras and _EXECUTION_TURN_INSTRUCTION in extras[0]


@pytest.mark.asyncio
async def test_near_meta_direct_at_member_starts_followup() -> None:
    router = _make_router()
    stream_order: list[str] = []

    async def _stub_analyze_intent(**kwargs):
        return IntentDecision("meta_direct", [], "pm")

    async def _stub_stream(**kwargs):
        aid = str(kwargs.get("avatar_id") or "")
        stream_order.append(aid)
        yield _reply(aid, "相关行已贴出。")

    async def _stub_meta(**kwargs):
        return GroupReply(
            agent_id=META_LEADER_AGENT_ID,
            avatar_name="Near",
            avatar_url="",
            content=NEAR_ASSIGNMENT,
            skipped=False,
            event_type="group_reply",
        )

    async def _stub_team(**kwargs):
        if False:
            yield _reply("x", "")
        return

    router._analyze_intent = _stub_analyze_intent  # type: ignore[assignment]
    router._run_one_target_stream = _stub_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = _stub_meta  # type: ignore[assignment]
    router._run_team_turn = _stub_team  # type: ignore[assignment]

    events: list[GroupReply] = []
    async for evt in router.run_group_turn(
        base_session=_make_session(),
        group_id="g1",
        group_name="Control Room",
        routing="intelligent",
        group_avatar_ids=["cheng", "wen"],
        mentioned_avatar_ids=[],
        user_input="倒计时和 gameState 对一下，10 分钟内出修复方案。",
        quoted_content="",
        should_stop=lambda: False,
    ):
        events.append(evt)

    assert "cheng" in stream_order
    assert any(e.agent_id == "cheng" and e.event_type == "group_typing" for e in events)
