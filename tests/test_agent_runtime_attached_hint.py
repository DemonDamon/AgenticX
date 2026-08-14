#!/usr/bin/env python3
"""Tests for user-message attached-files hint (context_files visibility).

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate
from agenticx.runtime.agent_runtime import _build_attached_files_hint


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


def test_build_attached_files_hint_lists_readable_text_files() -> None:
    session = SimpleNamespace(
        context_files={
            "/Users/damon/.agenticx/taskspaces/sid/default/attachments/对.md": "正文",
        }
    )
    hint = _build_attached_files_hint(session)
    assert "[已附文件]" in hint
    assert "对.md" in hint
    assert "/Users/damon/.agenticx/taskspaces/sid/default/attachments/对.md" in hint
    assert "context_files" in hint


def test_build_attached_files_hint_empty_when_no_readable_entries() -> None:
    assert _build_attached_files_hint(SimpleNamespace(context_files={})) == ""
    assert _build_attached_files_hint(SimpleNamespace(context_files=None)) == ""
    assert (
        _build_attached_files_hint(
            SimpleNamespace(context_files={"skill:demo": "skill body"})
        )
        == ""
    )
    assert (
        _build_attached_files_hint(
            SimpleNamespace(context_files={"/tmp/x.png": "[图片: x.png]"})
        )
        == ""
    )
    assert (
        _build_attached_files_hint(
            SimpleNamespace(context_files={"/tmp/a.md": "[附件] a.md"})
        )
        == ""
    )


@pytest.mark.asyncio
async def test_run_turn_injects_hint_into_model_messages_not_chat_history() -> None:
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.context_files = {"/abs/a.md": "body"}

    async for _event in runtime.run_turn("看下这个", session):
        pass

    user_msgs = [m for m in llm.messages if m.get("role") == "user"]
    assert user_msgs, "expected at least one user message sent to the provider"
    last_user = user_msgs[-1]["content"]
    assert isinstance(last_user, str)
    assert "[已附文件]" in last_user
    assert "a.md" in last_user
    assert "/abs/a.md" in last_user

    assert session.chat_history, "chat_history should persist the user turn"
    hist_users = [
        m for m in session.chat_history if isinstance(m, dict) and m.get("role") == "user"
    ]
    assert hist_users, "expected a user row in chat_history"
    hist_content = str(hist_users[-1].get("content") or "")
    assert "[已附文件]" not in hist_content
    assert hist_content == "看下这个"


@pytest.mark.asyncio
async def test_run_turn_appends_hint_to_multimodal_user_content() -> None:
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.context_files = {"/abs/notes.md": "hello notes"}
    multimodal = [
        {"type": "text", "text": "看图和附件"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,xx"}},
    ]

    async for _event in runtime.run_turn(
        "看图和附件",
        session,
        user_message_content=multimodal,
    ):
        pass

    user_msgs = [m for m in llm.messages if m.get("role") == "user"]
    assert user_msgs
    content = user_msgs[-1]["content"]
    assert isinstance(content, list)
    text_parts = [
        str(p.get("text") or "")
        for p in content
        if isinstance(p, dict) and p.get("type") == "text"
    ]
    joined = "\n".join(text_parts)
    assert "[已附文件]" in joined
    assert "notes.md" in joined
