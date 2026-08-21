#!/usr/bin/env python3
"""Smoke tests: group chat streams visible reply tokens.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import GroupChatRouter, GroupReply


def _make_avatar(name: str, role: str = "成员") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    avatar.system_prompt = ""
    avatar.avatar_url = ""
    avatar.default_provider = "openai"
    avatar.default_model = "gpt-4"
    return avatar


def _make_router() -> GroupChatRouter:
    avatar = _make_avatar("专家")
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=avatar)
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    router._project_h2a_fanout = MagicMock(return_value=[])  # type: ignore[assignment]
    return router


def _make_session() -> MagicMock:
    sess = MagicMock()
    sess.session_id = "group-stream-session"
    sess._session_id = "group-stream-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    return sess


def test_token_event_maps_to_group_token_delta() -> None:
    reply = GroupChatRouter._token_event_to_group_reply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        data={"text": "许可"},
    )
    assert reply is not None
    assert reply.event_type == "group_token"
    assert reply.content == "许可"
    assert reply.skipped is True
    assert GroupChatRouter._should_forward_progress(reply) is True


def test_token_event_skips_empty_and_hourglass() -> None:
    assert (
        GroupChatRouter._token_event_to_group_reply(
            agent_id="a1",
            avatar_name="专家",
            avatar_url="",
            data={"text": "⏳"},
        )
        is None
    )
    assert (
        GroupChatRouter._token_event_to_group_reply(
            agent_id="a1",
            avatar_name="专家",
            avatar_url="",
            data={"text": ""},
        )
        is None
    )


@pytest.mark.asyncio
async def test_run_one_target_enqueues_tokens_before_final(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(type=EventType.TOKEN.value, data={"text": "许"})
            yield SimpleNamespace(type=EventType.TOKEN.value, data={"text": "可证"})
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "许可证是 MIT。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router()
    session = _make_session()
    queue: asyncio.Queue[GroupReply] = asyncio.Queue()
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-stream",
        group_name="Stream",
        avatar_id="a1",
        user_input="许可证是什么",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
        progress_queue=queue,
    )
    assert reply.event_type == "group_reply"
    assert reply.content == "许可证是 MIT。"
    tokens = []
    while not queue.empty():
        evt = queue.get_nowait()
        if evt.event_type == "group_token":
            tokens.append(evt.content)
    assert tokens == ["许", "可证"]
