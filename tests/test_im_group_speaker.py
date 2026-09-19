#!/usr/bin/env python3
"""IM speaker fields for group-bound /api/chat bodies.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

import pytest

from agenticx.gateway.feishu_longconn import build_feishu_chat_body
from agenticx.gateway.im_group_speaker import (
    IM_CLARIFY_RELEASE_ANSWER,
    format_im_clarification,
    format_im_group_reply,
    group_id_from_session_avatar_id,
    human_member_payload,
    im_clarify_agent_id,
    im_clarification_request_id,
    latest_assistant_reply_after_user,
    latest_clarification_prompt,
    latest_unanswered_clarification,
    im_outbound_bubbles,
    merge_im_group_chat_fields,
    merge_im_sse_reply_text,
    register_human_member_best_effort,
    split_im_joined_bubbles,
    should_register_human,
    speaker_user_id,
)
from agenticx.gateway.adapters.wechat_ilink import build_wechat_chat_body


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


def test_format_im_clarification_keeps_skipped_group_card() -> None:
    text = format_im_clarification(
        {
            "content": "你说的「这个论文」是指哪一篇？",
            "avatar_name": "架构师·阿析",
            "skipped": True,
            "clarify_options": ["找一篇具体论文", "把已有文件发给你"],
        }
    )
    assert text.startswith("架构师·阿析：")
    assert "你说的「这个论文」是指哪一篇？" in text
    assert "1. 找一篇具体论文" in text
    assert "2. 把已有文件发给你" in text


def test_format_im_clarification_uses_prompt_field() -> None:
    assert format_im_clarification(
        {"prompt": "需要你补充一下", "options": ["继续", "取消"]}
    ) == "需要你补充一下\n1. 继续\n2. 取消"


def test_latest_clarification_prompt_skips_answered() -> None:
    messages = [
        {
            "role": "tool",
            "content": "旧问题",
            "metadata": {"kind": "clarification", "prompt": "旧问题"},
        },
        {
            "role": "tool",
            "content": "新问题",
            "sender_name": "架构师·阿析",
            "metadata": {
                "kind": "clarification",
                "prompt": "新问题",
                "options": ["A", "B"],
            },
        },
        {
            "role": "tool",
            "content": "已答",
            "metadata": {
                "kind": "clarification",
                "prompt": "已答",
                "clarification_answered": True,
            },
        },
    ]
    assert latest_clarification_prompt(messages) == "架构师·阿析：新问题\n1. A\n2. B"


def test_im_clarification_request_id_reads_group_and_meta_fields() -> None:
    assert im_clarification_request_id({"confirm_request_id": "c1"}) == "c1"
    assert im_clarification_request_id({"id": "c2"}) == "c2"
    assert im_clarification_request_id({"request_id": "c3"}) == "c3"
    assert im_clarification_request_id({}) == ""


def test_im_clarify_agent_id_normalizes_meta() -> None:
    assert im_clarify_agent_id({}) == "meta"
    assert im_clarify_agent_id({"agent_id": "__meta__"}) == "meta"
    assert im_clarify_agent_id({"agent_id": "meta"}) == "meta"
    assert im_clarify_agent_id({"agent_id": "12e6fedc069f"}) == "12e6fedc069f"


def test_latest_unanswered_clarification_returns_request_and_text() -> None:
    request_id, agent_id, text = latest_unanswered_clarification(
        [
            {
                "role": "tool",
                "content": "需要补充",
                "agent_id": "__meta__",
                "metadata": {
                    "kind": "clarification",
                    "request_id": "req-9",
                    "prompt": "需要补充",
                },
            }
        ]
    )
    assert request_id == "req-9"
    assert agent_id == "meta"
    assert "需要补充" in text
    assert "下一轮" in IM_CLARIFY_RELEASE_ANSWER or "附件" in IM_CLARIFY_RELEASE_ANSWER


def test_im_outbound_bubbles_keeps_two_speakers_separate() -> None:
    assert im_outbound_bubbles(
        final_text="",
        group_chunks=["架构师·阿析：论文找到了", "后端·北辰：点链接下载"],
    ) == ["架构师·阿析：论文找到了", "后端·北辰：点链接下载"]


def test_split_im_joined_bubbles_two_speakers() -> None:
    joined = "架构师·阿析：论文找到了\n\n后端·北辰：点链接下载"
    assert split_im_joined_bubbles(joined) == [
        "架构师·阿析：论文找到了",
        "后端·北辰：点链接下载",
    ]


def test_merge_im_sse_reply_text_prefers_group_chunks() -> None:
    assert merge_im_sse_reply_text("", ["Nearer：你好", "架构师·阿析：在的"]) == (
        "Nearer：你好\n\n架构师·阿析：在的"
    )
    assert merge_im_sse_reply_text("plain", ["群：补一句"]) == "plain\n\n群：补一句"


def test_merge_im_sse_reply_text_uses_group_token_when_reply_missing() -> None:
    assert merge_im_sse_reply_text("", [], token_text="南沙明天多云") == "南沙明天多云"
    assert merge_im_sse_reply_text("", ["北辰：终局"], token_text="半句") == "北辰：终局"


def test_latest_assistant_reply_after_user_skips_stale_and_progress() -> None:
    messages = [
        {"role": "user", "content": "转成word发给我吧"},
        {"role": "assistant", "content": "Word 版已经生成好了", "avatar_name": "Near"},
        {"role": "user", "content": "明天天气怎么样南沙"},
        {"role": "assistant", "content": "南沙明天多云转晴", "avatar_name": "后端·北辰"},
    ]
    assert latest_assistant_reply_after_user(messages, "明天天气怎么样南沙") == (
        "后端·北辰：南沙明天多云转晴"
    )
    two = [
        {"role": "user", "content": "把这个论文发给我"},
        {"role": "assistant", "content": "论文找到了", "avatar_name": "架构师·阿析"},
        {"role": "assistant", "content": "点链接下载", "avatar_name": "后端·北辰"},
    ]
    assert latest_assistant_reply_after_user(two, "把这个论文发给我") == (
        "架构师·阿析：论文找到了\n\n后端·北辰：点链接下载"
    )
    assert latest_assistant_reply_after_user(messages, "没问过这个问题") == ""


def test_build_wechat_chat_body_keeps_runtime_after_disconnect() -> None:
    body = build_wechat_chat_body(
        session_id="sess-g",
        text="明天天气怎么样南沙",
        sender_name="wx-user",
        sender_key="wechat:wx-user",
        session_avatar_id="",
    )
    assert body["session_id"] == "sess-g"
    assert body["user_input"] == "明天天气怎么样南沙"
    assert body["keep_runtime_after_disconnect"] is True
    assert "group_id" not in body
