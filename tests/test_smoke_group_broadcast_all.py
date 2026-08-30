#!/usr/bin/env python3
"""Smoke tests: pin broadcast_all full-member turns.

钉住「各自 / 每个人 / 全员」：全体顺序上场、强制回复、大群先确认。

Author: Damon Li
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agenticx.runtime.group_router import (
    META_LEADER_AGENT_ID,
    GroupChatRouter,
    GroupReply,
    IntentDecision,
    _BROADCAST_ALL_ASK_THRESHOLD,
    _BROADCAST_ALL_PENDING_PREFIX,
    _is_broadcast_all_affirmation,
    _is_broadcast_all_request,
)


def _make_avatar(name: str, role: str = "成员") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router_with_spies(avatar_ids: list[str] | None = None) -> GroupChatRouter:
    ids = avatar_ids or ["a1", "a2", "a3", "a4"]
    avatars = {aid: _make_avatar(aid) for aid in ids}
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    router._project_h2a_fanout = MagicMock(return_value=[])  # type: ignore[assignment]
    return router


def _make_session(avatar_ids: list[str] | None = None) -> MagicMock:
    sess = MagicMock()
    sess.session_id = "broadcast-all-session"
    sess._session_id = "broadcast-all-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = avatar_ids or ["a1", "a2", "a3", "a4"]
    return sess


def _reply(
    agent_id: str,
    content: str,
    *,
    skipped: bool = False,
    event_type: str = "group_reply",
) -> GroupReply:
    return GroupReply(
        agent_id=agent_id,
        avatar_name=agent_id,
        avatar_url="",
        content=content,
        skipped=skipped,
        event_type=event_type,
    )


def _install_turn_stubs(
    router: GroupChatRouter,
    *,
    decision: IntentDecision,
    stream_by_id: dict[str, GroupReply],
    force_reply_calls: list[bool] | None = None,
    stream_order: list[str] | None = None,
    extra_instructions: list[str] | None = None,
    user_inputs: list[str] | None = None,
) -> None:
    async def _stub_analyze_intent(**kwargs):
        return decision

    async def _stub_one_target_stream(**kwargs):
        aid = str(kwargs.get("avatar_id") or "")
        if stream_order is not None:
            stream_order.append(aid)
        if force_reply_calls is not None:
            force_reply_calls.append(bool(kwargs.get("force_reply")))
        if extra_instructions is not None:
            extra_instructions.append(str(kwargs.get("extra_instruction") or ""))
        if user_inputs is not None:
            user_inputs.append(str(kwargs.get("user_input") or ""))
        yield stream_by_id.get(aid, _reply(aid, f"我是{aid}"))

    async def _stub_team_turn(**kwargs):
        if False:
            yield _reply("x", "")
        return

    router._analyze_intent = _stub_analyze_intent  # type: ignore[assignment]
    router._run_one_target_stream = _stub_one_target_stream  # type: ignore[assignment]
    router._run_team_turn = _stub_team_turn  # type: ignore[assignment]


async def _collect_turn(
    router: GroupChatRouter,
    *,
    avatar_ids: list[str],
    user_input: str = "各自介绍一下自己",
    mentioned_avatar_ids: list[str] | None = None,
    should_stop=None,
    session: MagicMock | None = None,
) -> tuple[list[GroupReply], MagicMock]:
    sess = session or _make_session(avatar_ids)
    events: list[GroupReply] = []
    async for evt in router.run_group_turn(
        base_session=sess,
        group_id="g-broadcast-all",
        group_name="Broadcast All",
        routing="intelligent",
        group_avatar_ids=avatar_ids,
        mentioned_avatar_ids=mentioned_avatar_ids or [],
        user_input=user_input,
        quoted_content="",
        should_stop=should_stop or (lambda: False),
    ):
        events.append(evt)
    return events, sess


@pytest.mark.parametrize(
    "text",
    [
        "各自介绍一下自己",
        "请每个人都介绍一下",
        "所有人说一下你是谁",
        "全员发言介绍自己",
        "都说说自己擅长什么",
        "请逐个介绍一下",
        "依次回答你们的职责",
    ],
)
def test_broadcast_all_heuristic_matches(text: str) -> None:
    assert _is_broadcast_all_request(text), f"Should match broadcast-all: {text!r}"


@pytest.mark.parametrize(
    "text",
    [
        "大家好怎么看",
        "你们平时都聊啥",
        "群里谁能介绍一下这个仓库",
        "哪位帮我看下",
        "你好",
        "每个人都知道这个问题",
        "",
    ],
)
def test_broadcast_all_heuristic_skips(text: str) -> None:
    assert not _is_broadcast_all_request(text), f"Should NOT match: {text!r}"


@pytest.mark.parametrize("text", ["继续", "全员", "好的", "是"])
def test_broadcast_all_affirmation_matches(text: str) -> None:
    assert _is_broadcast_all_affirmation(text)


def test_broadcast_all_affirmation_skips_prose() -> None:
    assert not _is_broadcast_all_affirmation("是不是只有两个人")
    assert not _is_broadcast_all_affirmation("继续推进架构方案")


@pytest.mark.asyncio
async def test_broadcast_all_invites_every_member() -> None:
    ids = ["a1", "a2", "a3", "a4"]
    router = _make_router_with_spies(ids)
    force_reply_calls: list[bool] = []
    stream_order: list[str] = []
    extra_instructions: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={aid: _reply(aid, f"我是{aid}") for aid in ids},
        force_reply_calls=force_reply_calls,
        stream_order=stream_order,
        extra_instructions=extra_instructions,
    )
    events, _ = await _collect_turn(router, avatar_ids=ids)
    replies = [e for e in events if e.event_type == "group_reply"]
    assert [e.agent_id for e in replies] == ids
    assert stream_order == ids
    assert force_reply_calls == [True, True, True, True]
    assert extra_instructions
    assert all("亲自回答" in item for item in extra_instructions)


@pytest.mark.asyncio
async def test_broadcast_all_ignores_open_floor_cap() -> None:
    ids = ["a1", "a2", "a3"]
    router = _make_router_with_spies(ids)
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={aid: _reply(aid, f"我是{aid}") for aid in ids},
        stream_order=stream_order,
    )
    await _collect_turn(router, avatar_ids=ids)
    assert stream_order == ids


@pytest.mark.asyncio
async def test_explicit_mention_skips_broadcast_all() -> None:
    ids = ["a1", "a2", "a3", "a4"]
    router = _make_router_with_spies(ids)
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("route_to", ["a2"], "explicit_mention"),
        stream_by_id={
            "a2": _reply("a2", "只有我"),
            "a1": _reply("a1", "不该上场"),
        },
        stream_order=stream_order,
    )
    events, _ = await _collect_turn(
        router,
        avatar_ids=ids,
        user_input="@a2 各自介绍一下自己",
        mentioned_avatar_ids=["a2"],
    )
    replies = [e for e in events if e.event_type == "group_reply"]
    assert [e.agent_id for e in replies] == ["a2"]
    assert stream_order == ["a2"]


@pytest.mark.asyncio
async def test_large_group_asks_before_broadcast() -> None:
    ids = [f"a{i}" for i in range(1, _BROADCAST_ALL_ASK_THRESHOLD + 2)]
    router = _make_router_with_spies(ids)
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={aid: _reply(aid, f"我是{aid}") for aid in ids},
        stream_order=stream_order,
    )
    events, sess = await _collect_turn(router, avatar_ids=ids)
    replies = [e for e in events if e.event_type == "group_reply"]
    assert stream_order == []
    assert len(replies) == 1
    assert replies[0].agent_id == META_LEADER_AGENT_ID
    assert "全员回答" in replies[0].content
    pending = sess.scratchpad.get(f"{_BROADCAST_ALL_PENDING_PREFIX}g-broadcast-all")
    assert isinstance(pending, dict)
    assert pending["user_input"] == "各自介绍一下自己"


@pytest.mark.asyncio
async def test_large_group_affirmation_runs_original_prompt() -> None:
    ids = [f"a{i}" for i in range(1, _BROADCAST_ALL_ASK_THRESHOLD + 2)]
    router = _make_router_with_spies(ids)
    stream_order: list[str] = []
    user_inputs: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={aid: _reply(aid, f"我是{aid}") for aid in ids},
        stream_order=stream_order,
        user_inputs=user_inputs,
    )
    _, sess = await _collect_turn(router, avatar_ids=ids)
    events, sess = await _collect_turn(
        router,
        avatar_ids=ids,
        user_input="继续",
        session=sess,
    )
    replies = [e for e in events if e.event_type == "group_reply"]
    assert stream_order == ids
    assert [e.agent_id for e in replies] == ids
    assert user_inputs
    assert all(item == "各自介绍一下自己" for item in user_inputs)
    assert f"{_BROADCAST_ALL_PENDING_PREFIX}g-broadcast-all" not in sess.scratchpad


@pytest.mark.asyncio
async def test_broadcast_all_honors_should_stop() -> None:
    ids = ["a1", "a2", "a3", "a4"]
    router = _make_router_with_spies(ids)
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={aid: _reply(aid, f"我是{aid}") for aid in ids},
        stream_order=stream_order,
    )
    stop_after = {"count": 0}

    def _should_stop() -> bool:
        return stop_after["count"] >= 1

    orig = router._run_one_target_stream

    async def _counting_stream(**kwargs):
        async for evt in orig(**kwargs):
            if evt.event_type in {"group_reply", "group_skipped"}:
                stop_after["count"] += 1
            yield evt

    router._run_one_target_stream = _counting_stream  # type: ignore[assignment]
    events, _ = await _collect_turn(router, avatar_ids=ids, should_stop=_should_stop)
    replies = [e for e in events if e.event_type == "group_reply"]
    assert [e.agent_id for e in replies] == ["a1"]
    assert stream_order == ["a1"]
