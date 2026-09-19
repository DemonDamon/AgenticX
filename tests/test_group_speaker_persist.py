#!/usr/bin/env python3
"""Persist real sender_id on group user rows.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, AsyncGenerator
from unittest.mock import patch

import pytest

from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import GroupChatRouter, GroupReply
from agenticx.studio.protocols import ChatRequest


def test_append_user_defaults_sender_id() -> None:
    session = SimpleNamespace(chat_history=[])
    GroupChatContext(session).append_user("hello")
    row = session.chat_history[0]
    assert row["role"] == "user"
    assert row["sender_id"] == "user"
    assert row["agent_id"] == "user"


def test_append_user_overrides_sender_id() -> None:
    session = SimpleNamespace(chat_history=[])
    GroupChatContext(session).append_user(
        "进度如何",
        sender_name="甲",
        sender_id="human:feishu:ou_1",
    )
    row = session.chat_history[0]
    assert row["role"] == "user"
    assert row["sender_id"] == "human:feishu:ou_1"
    assert row["agent_id"] == "human:feishu:ou_1"
    assert row["sender_name"] == "甲"
    recent = GroupChatContext(session).recent()
    assert recent[0].sender_id == "human:feishu:ou_1"


def test_chat_request_accepts_speaker_user_id() -> None:
    req = ChatRequest(session_id="s1", user_input="hi", speaker_user_id="human:feishu:ou_1")
    assert req.speaker_user_id == "human:feishu:ou_1"


@pytest.mark.asyncio
async def test_run_group_turn_passes_speaker_id() -> None:
    captured: dict[str, Any] = {}

    async def _fake_iter(_self, **kwargs) -> AsyncGenerator[GroupReply, None]:
        captured.update(kwargs)
        if False:
            yield GroupReply(
                agent_id="meta",
                avatar_name="Near",
                avatar_url="",
                content="",
            )  # pragma: no cover

    router = GroupChatRouter.__new__(GroupChatRouter)
    session = SimpleNamespace(scratchpad={})
    with patch.object(GroupChatRouter, "_iter_group_turn", _fake_iter):
        async for _ in router.run_group_turn(
            base_session=session,
            group_id="g1",
            group_name="小团",
            routing="intelligent",
            group_avatar_ids=["a1"],
            mentioned_avatar_ids=[],
            user_input="进度如何",
            quoted_content="",
            should_stop=lambda: False,
            speaker_user_id="human:feishu:ou_1",
        ):
            pass
    assert captured["speaker_user_id"] == "human:feishu:ou_1"


def test_append_user_skips_identical_tail() -> None:
    session = SimpleNamespace(chat_history=[])
    ctx = GroupChatContext(session)
    attachments = [{"name": "shot.jpg", "mime_type": "image/jpeg", "size": 12}]
    ctx.append_user(
        "把这个论文发给我",
        sender_name="我",
        sender_id="human:wechat:u1",
        attachments=attachments,
    )
    ctx.append_user(
        "把这个论文发给我",
        sender_name="我",
        sender_id="human:wechat:u1",
        attachments=attachments,
    )
    assert len(session.chat_history) == 1
    ctx.append_user("追问一句", sender_name="我", sender_id="human:wechat:u1")
    assert len(session.chat_history) == 2
