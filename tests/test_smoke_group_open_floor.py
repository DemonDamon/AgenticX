#!/usr/bin/env python3
"""Smoke tests: pin open_floor chitchat turns.

钉住 open_floor 闲聊轮：可跳过、可零发言、不催人、字面判重。

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import (
    META_LEADER_AGENT_ID,
    GroupChatRouter,
    GroupReply,
    IntentDecision,
    _is_verbatim_duplicate,
)
from agenticx.runtime.harden_flags import (
    group_open_floor_enabled,
    group_open_floor_max_speakers,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_avatar(name: str, role: str = "成员") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router_with_spies(avatar_ids: list[str] | None = None) -> GroupChatRouter:
    """Build a GroupChatRouter with named members and a no-op graph fan-out."""
    ids = avatar_ids or ["a1", "a2", "a3"]
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
    sess.session_id = "open-floor-session"
    sess._session_id = "open-floor-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = avatar_ids or ["a1", "a2", "a3"]
    return sess


def _isolate_open_floor_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_GROUP_OPEN_FLOOR", raising=False)
    monkeypatch.delenv("AGX_GROUP_OPEN_FLOOR_MAX_SPEAKERS", raising=False)
    monkeypatch.setattr(
        "agenticx.runtime.harden_flags._config_bool",
        lambda key: None,
    )
    monkeypatch.setattr(
        "agenticx.runtime.harden_flags._config_int",
        lambda key: None,
    )


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
    meta_reply: GroupReply | None = None,
    force_reply_calls: list[bool] | None = None,
    stream_order: list[str] | None = None,
    extra_instructions: list[str] | None = None,
) -> None:
    async def _stub_analyze_intent(**kwargs):
        return decision

    async def _stub_one_target_stream(**kwargs):
        aid = str(kwargs.get("avatar_id") or "")
        if stream_order is not None:
            stream_order.append(aid)
        if force_reply_calls is not None:
            force_reply_calls.append(bool(kwargs.get("force_reply")))
        yield stream_by_id.get(aid, _reply(aid, "", skipped=True, event_type="group_skipped"))

    async def _stub_meta_pm(**kwargs):
        if extra_instructions is not None:
            extra_instructions.append(str(kwargs.get("extra_instruction") or ""))
        return meta_reply or _reply(
            META_LEADER_AGENT_ID,
            "哈哈没啥固定套路",
        )

    async def _stub_team_turn(**kwargs):
        if False:
            yield _reply("x", "")
        return

    router._analyze_intent = _stub_analyze_intent  # type: ignore[assignment]
    router._run_one_target_stream = _stub_one_target_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = _stub_meta_pm  # type: ignore[assignment]
    router._run_team_turn = _stub_team_turn  # type: ignore[assignment]


async def _collect_turn(
    router: GroupChatRouter,
    *,
    avatar_ids: list[str],
    user_input: str = "瞎扯把",
) -> list[GroupReply]:
    session = _make_session(avatar_ids)
    events: list[GroupReply] = []
    async for evt in router.run_group_turn(
        base_session=session,
        group_id="g-open-floor",
        group_name="Open Floor",
        routing="intelligent",
        group_avatar_ids=avatar_ids,
        mentioned_avatar_ids=[],
        user_input=user_input,
        quoted_content="",
        should_stop=lambda: False,
    ):
        events.append(evt)
    return events


# ---------------------------------------------------------------------------
# FR-1: _analyze_intent parses / keeps / remaps open_floor
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analyze_intent_parses_open_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate_open_floor_flags(monkeypatch)
    router = _make_router_with_spies(["a1", "a2", "a3"])

    async def stub_llm(**kwargs):
        return '{"action":"open_floor","target_ids":["a1","a2","a3"],"reason":"chitchat"}'

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2", "a3"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Open Floor",
        group_avatar_ids=["a1", "a2", "a3"],
        user_input="你们平时都聊啥",
        explicit_targets=[],
    )
    assert decision.action == "open_floor"
    assert decision.target_ids == ["a1", "a2"]


@pytest.mark.asyncio
async def test_analyze_intent_open_floor_allows_empty_targets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_open_floor_flags(monkeypatch)
    router = _make_router_with_spies(["a1", "a2", "a3"])

    async def stub_llm(**kwargs):
        return '{"action":"open_floor","target_ids":[],"reason":"chitchat"}'

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2", "a3"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Open Floor",
        group_avatar_ids=["a1", "a2", "a3"],
        user_input="瞎扯把",
        explicit_targets=[],
    )
    assert decision.action == "open_floor"
    assert decision.target_ids == []


@pytest.mark.asyncio
async def test_analyze_intent_open_floor_disabled_by_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_open_floor_flags(monkeypatch)
    monkeypatch.setenv("AGX_GROUP_OPEN_FLOOR", "0")
    router = _make_router_with_spies(["a1", "a2", "a3"])

    async def stub_llm(**kwargs):
        return '{"action":"open_floor","target_ids":["a1"],"reason":"chitchat"}'

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2", "a3"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Open Floor",
        group_avatar_ids=["a1", "a2", "a3"],
        user_input="瞎扯把",
        explicit_targets=[],
    )
    assert decision.action == "route_to"
    assert decision.target_ids == ["a1"]


# ---------------------------------------------------------------------------
# FR-2: open_floor turn — skip, never force, empty-target fallback
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_floor_two_candidates_second_may_skip() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "我来接一句"),
            "a2": _reply("a2", "", skipped=True, event_type="group_skipped"),
        },
    )
    events = await _collect_turn(router, avatar_ids=["a1", "a2"])
    replies = [e for e in events if e.event_type == "group_reply"]
    assert len(replies) == 1
    assert replies[0].agent_id == "a1"
    assert all(e.event_type != "group_nudge" for e in events)


@pytest.mark.asyncio
async def test_open_floor_never_forces_reply() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    force_reply_calls: list[bool] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "我来接一句"),
            "a2": _reply("a2", "", skipped=True, event_type="group_skipped"),
        },
        force_reply_calls=force_reply_calls,
    )
    await _collect_turn(router, avatar_ids=["a1", "a2"])
    assert force_reply_calls
    assert all(flag is False for flag in force_reply_calls)


@pytest.mark.asyncio
async def test_open_floor_falls_back_to_members_when_targets_empty() -> None:
    router = _make_router_with_spies(["a1", "a2", "a3"])
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", [], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "我来"),
            "a2": _reply("a2", "", skipped=True, event_type="group_skipped"),
            "a3": _reply("a3", "不该上场"),
        },
        stream_order=stream_order,
    )
    await _collect_turn(router, avatar_ids=["a1", "a2", "a3"])
    assert stream_order == ["a1", "a2"]


# ---------------------------------------------------------------------------
# FR-3: all-skip → casual meta, and route_to nudge still intact
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_floor_all_skipped_gets_casual_meta_reply_not_nudge() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    extra_instructions: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "", skipped=True, event_type="group_skipped"),
            "a2": _reply("a2", "", skipped=True, event_type="group_skipped"),
        },
        meta_reply=_reply(META_LEADER_AGENT_ID, "哈哈没啥固定套路"),
        extra_instructions=extra_instructions,
    )
    events = await _collect_turn(router, avatar_ids=["a1", "a2"])
    assert all(e.event_type != "group_nudge" for e in events)
    replies = [e for e in events if e.event_type == "group_reply"]
    assert replies
    assert replies[-1].agent_id == META_LEADER_AGENT_ID
    assert extra_instructions
    assert "没人接话" in extra_instructions[-1]


@pytest.mark.asyncio
async def test_route_to_nudge_path_unchanged() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    _install_turn_stubs(
        router,
        decision=IntentDecision("route_to", ["a1"], "duty"),
        stream_by_id={
            "a1": _reply("a1", "", skipped=True, event_type="group_skipped"),
        },
    )
    events = await _collect_turn(
        router,
        avatar_ids=["a1", "a2"],
        user_input="帮我看下这个报错",
    )
    assert any(e.event_type == "group_nudge" for e in events)


# ---------------------------------------------------------------------------
# FR-4: verbatim duplicate
# ---------------------------------------------------------------------------

def test_verbatim_duplicate_pure_function() -> None:
    assert _is_verbatim_duplicate("好的", ["好的"]) is True
    assert _is_verbatim_duplicate(" 好的\n", ["好的"]) is True
    assert _is_verbatim_duplicate("好的呀", ["好的"]) is False
    assert _is_verbatim_duplicate("", ["好的"]) is False
    assert _is_verbatim_duplicate("好的", []) is False


@pytest.mark.asyncio
async def test_open_floor_drops_verbatim_duplicate_bubble() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "我也这么觉得"),
            "a2": _reply("a2", "我也这么觉得"),
        },
    )
    events = await _collect_turn(router, avatar_ids=["a1", "a2"])
    replies = [e for e in events if e.event_type == "group_reply"]
    assert len(replies) == 1
    assert replies[0].agent_id == "a1"
    skipped = [e for e in events if e.event_type == "group_skipped" and e.agent_id == "a2"]
    assert skipped


# ---------------------------------------------------------------------------
# FR-5: member prompt shape-level yield rules
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_member_prompt_contains_yield_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[str] = []

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured.append(str(kwargs.get("system_prompt") or ""))
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "__SKIP__"})

    monkeypatch.setattr(
        "agenticx.runtime.group_router.AgentRuntime",
        _CapturingRuntime,
    )
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-open-floor",
        group_name="Open Floor",
        avatar_id="a1",
        user_input="瞎扯把",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=False,
    )
    assert captured
    prompt = captured[0]
    assert "就让当事人先答" in prompt
    assert "已经发出" in prompt
    assert "宁可不说" in prompt
    assert "不要流式、不分段" in prompt


# ---------------------------------------------------------------------------
# FR-6: internal rollback flags
# ---------------------------------------------------------------------------

def test_open_floor_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate_open_floor_flags(monkeypatch)
    assert group_open_floor_enabled() is True
    assert group_open_floor_max_speakers() == 2

    monkeypatch.setenv("AGX_GROUP_OPEN_FLOOR", "0")
    assert group_open_floor_enabled() is False

    monkeypatch.setenv("AGX_GROUP_OPEN_FLOOR_MAX_SPEAKERS", "9")
    assert group_open_floor_max_speakers() == 3

    monkeypatch.setenv("AGX_GROUP_OPEN_FLOOR_MAX_SPEAKERS", "0")
    assert group_open_floor_max_speakers() == 1

    monkeypatch.setenv("AGX_GROUP_OPEN_FLOOR_MAX_SPEAKERS", "abc")
    assert group_open_floor_max_speakers() == 2
