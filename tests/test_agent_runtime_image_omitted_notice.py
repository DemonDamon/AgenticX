#!/usr/bin/env python3
"""Tests for non-vision image-omitted analyze_image notice.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _CaptureMessagesLLM:
    def __init__(self) -> None:
        self.messages: List[Dict[str, Any]] = []

    def invoke(self, messages, **_kwargs):
        self.messages = [dict(item) for item in messages]
        return _FakeResponse("ok", [])


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


def _image_attachments() -> list[dict[str, Any]]:
    return [
        {
            "name": "org.png",
            "mime_type": "image/png",
            "data_url": "data:image/png;base64,xx",
        }
    ]


@pytest.mark.asyncio
async def test_run_turn_injects_analyze_image_notice_for_text_model() -> None:
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-5.2"

    async for _event in runtime.run_turn(
        "帮我查下这个组织",
        session,
        history_user_attachments=_image_attachments(),
    ):
        pass

    user_msgs = [m for m in llm.messages if m.get("role") == "user"]
    assert user_msgs
    last_user = user_msgs[-1]["content"]
    assert isinstance(last_user, str)
    assert "analyze_image" in last_user
    assert "org.png" in last_user

    hist_users = [
        m for m in session.chat_history if isinstance(m, dict) and m.get("role") == "user"
    ]
    assert hist_users
    hist_content = str(hist_users[-1].get("content") or "")
    assert "analyze_image" not in hist_content
    assert hist_content == "帮我查下这个组织"


@pytest.mark.asyncio
async def test_run_turn_skips_omit_notice_for_vision_model() -> None:
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-4.6v"

    async for _event in runtime.run_turn(
        "帮我查下这个组织",
        session,
        history_user_attachments=_image_attachments(),
    ):
        pass

    user_msgs = [m for m in llm.messages if m.get("role") == "user"]
    assert user_msgs
    last_user = user_msgs[-1]["content"]
    joined = last_user if isinstance(last_user, str) else str(last_user)
    assert "analyze_image" not in joined
