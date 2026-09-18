#!/usr/bin/env python3
"""IM speaker fields for group-bound /api/chat bodies.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

import pytest

from agenticx.gateway.feishu_longconn import build_feishu_chat_body
from agenticx.gateway.im_group_speaker import (
    format_im_group_reply,
    group_id_from_session_avatar_id,
    human_member_payload,
    merge_im_group_chat_fields,
    merge_im_sse_reply_text,
    register_human_member_best_effort,
    should_register_human,
    speaker_user_id,
)


def test_speaker_user_id_feishu() -> None:
    assert speaker_user_id("feishu", "ou_1") == "human:feishu:ou_1"


def test_group_id_from_session_avatar_id() -> None:
    assert group_id_from_session_avatar_id("") == ""
    assert group_id_from_session_avatar_id("abc") == ""
    assert group_id_from_session_avatar_id("group:deadbeef") == "deadbeef"


def test_merge_skips_group_fields_when_not_group() -> None:
    body = {
        "session_id": "s1",
        "user_input": "hi",
        "keep_runtime_after_disconnect": True,
    }
    out = merge_im_group_chat_fields(
        body,
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
        session_avatar_id="",
    )
    assert "group_id" not in out
    assert "speaker_user_id" not in out
    assert out["session_id"] == "s1"
    assert out["user_input"] == "hi"
    assert out["keep_runtime_after_disconnect"] is True
    assert out["user_display_name"] == "甲"

    out2 = merge_im_group_chat_fields(
        body,
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
        session_avatar_id="abc",
    )
    assert "group_id" not in out2
    assert "speaker_user_id" not in out2


def test_merge_adds_group_fields() -> None:
    body = {
        "session_id": "s1",
        "user_input": "进度如何",
        "keep_runtime_after_disconnect": True,
    }
    out = merge_im_group_chat_fields(
        body,
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
        session_avatar_id="group:deadbeef",
    )
    assert out["group_id"] == "deadbeef"
    assert out["speaker_user_id"] == "human:feishu:ou_1"
    assert out["session_id"] == "s1"
    assert out["user_input"] == "进度如何"
    assert out["keep_runtime_after_disconnect"] is True
    assert out["user_display_name"] == "甲"


def test_merge_invalid_platform_raises() -> None:
    with pytest.raises(ValueError):
        merge_im_group_chat_fields(
            {"session_id": "s1"},
            platform="dingtalk",
            external_id="u1",
            display_name="甲",
            session_avatar_id="group:g1",
        )


def test_should_register_human() -> None:
    assert should_register_human("group:g1") is True
    assert should_register_human("") is False
    assert should_register_human("avatar-x") is False


def test_human_member_payload() -> None:
    assert human_member_payload("feishu", "ou_1", "甲") == {
        "platform": "feishu",
        "external_id": "ou_1",
        "display_name": "甲",
    }


def test_build_feishu_chat_body_private_session() -> None:
    body = build_feishu_chat_body(
        session_id="im-feishu-lc-abc",
        text="hello",
        sender_name="甲",
        sender_key="feishu:ou_1",
        avatar_id=None,
    )
    assert body["session_id"] == "im-feishu-lc-abc"
    assert body["user_input"] == "hello"
    assert body["user_display_name"] == "甲"
    assert body["keep_runtime_after_disconnect"] is True
    assert "group_id" not in body
    assert "speaker_user_id" not in body


def test_build_feishu_chat_body_group_session() -> None:
    body = build_feishu_chat_body(
        session_id="sess-g",
        text="进度如何",
        sender_name="甲",
        sender_key="feishu:ou_1",
        avatar_id="group:deadbeef",
        provider="openai",
        model="gpt-5",
    )
    assert body["group_id"] == "deadbeef"
    assert body["speaker_user_id"] == "human:feishu:ou_1"
    assert body["provider"] == "openai"
    assert body["model"] == "gpt-5"


@pytest.mark.asyncio
async def test_register_swallows_http_error_and_merge_still_works() -> None:
    class Boom:
        async def post(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("down")

    await register_human_member_best_effort(
        client=Boom(),
        studio_base="http://127.0.0.1:1",
        headers={},
        session_avatar_id="group:g1",
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
    )
    out = merge_im_group_chat_fields(
        {"session_id": "s1", "user_input": "hi"},
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
        session_avatar_id="group:g1",
    )
    assert out["speaker_user_id"] == "human:feishu:ou_1"


@pytest.mark.asyncio
async def test_register_swallows_4xx() -> None:
    class Resp:
        status_code = 400
        text = "nope"

    class Client:
        async def post(self, *args: Any, **kwargs: Any) -> Resp:
            return Resp()

    await register_human_member_best_effort(
        client=Client(),
        studio_base="http://127.0.0.1:9",
        headers={"x-agx-desktop-token": "t"},
        session_avatar_id="group:g1",
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
    )


@pytest.mark.asyncio
async def test_register_skips_non_group() -> None:
    called = {"n": 0}

    class Client:
        async def post(self, *args: Any, **kwargs: Any) -> Any:
            called["n"] += 1
            raise AssertionError("should not POST")

    await register_human_member_best_effort(
        client=Client(),
        studio_base="http://127.0.0.1:9",
        headers={},
        session_avatar_id="abc",
        platform="feishu",
        external_id="ou_1",
        display_name="甲",
    )
    assert called["n"] == 0


def test_format_im_group_reply_skips_progress() -> None:
    assert format_im_group_reply({"content": "x", "skipped": True}) == ""
    assert format_im_group_reply({"content": "x", "tool_phase": "calling"}) == ""
    assert format_im_group_reply({"content": ""}) == ""


def test_format_im_group_reply_includes_speaker() -> None:
    assert format_im_group_reply(
        {"content": "我是阿析", "avatar_name": "架构师·阿析"}
    ) == "架构师·阿析：我是阿析"


def test_merge_im_sse_reply_text_prefers_group_chunks() -> None:
    assert merge_im_sse_reply_text("", ["Nearer：你好", "架构师·阿析：在的"]) == (
        "Nearer：你好\n\n架构师·阿析：在的"
    )
    assert merge_im_sse_reply_text("plain", ["群：补一句"]) == "plain\n\n群：补一句"
