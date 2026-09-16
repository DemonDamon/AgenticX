#!/usr/bin/env python3
"""Group prompts must include hydrated context_files bodies.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.context_file_budget import CONTEXT_FILES_USAGE_HINT
from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import GroupChatRouter, GroupReply


def _make_avatar(name: str = "程基岩") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = "专家"
    avatar.system_prompt = ""
    avatar.avatar_url = ""
    avatar.default_provider = ""
    avatar.default_model = ""
    return avatar


def _make_router(avatar: MagicMock | None = None) -> GroupChatRouter:
    av = avatar or _make_avatar()
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=av)
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=3,
    )


def _make_session(*, context_files: dict | None = None, workspace: str = "/tmp/ws") -> MagicMock:
    sess = MagicMock()
    sess.session_id = "cf-group-session"
    sess._session_id = "cf-group-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = workspace
    sess.context_files = dict(context_files or {})
    sess.taskspaces = [{"id": "default", "path": workspace}]
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = ["cheng"]
    return sess


@pytest.mark.asyncio
async def test_run_one_target_system_prompt_includes_context_file_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    abs_path = "/tmp/other-taskspace/MHS-notes.md"
    body = "这是跨 taskspace 引用的正文 UNIQUE_TOKEN_A1B2"
    captured: dict[str, str] = {}

    class _CaptureRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured["system_prompt"] = str(kwargs.get("system_prompt") or "")
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "已阅读。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CaptureRuntime)
    router = _make_router()
    session = _make_session(context_files={abs_path: body})
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="cheng",
        user_input="根据 @MHS-notes.md 总结要点",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert reply.skipped is False
    prompt = captured["system_prompt"]
    assert f"--- {abs_path} ---" in prompt
    assert "UNIQUE_TOKEN_A1B2" in prompt
    assert "请直接使用正文回答" in prompt or CONTEXT_FILES_USAGE_HINT.split("。")[0] in prompt
    assert "### 用户引用的文件（context_files）" in prompt


@pytest.mark.asyncio
async def test_run_one_target_skips_empty_context_files_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, str] = {}

    class _CaptureRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured["system_prompt"] = str(kwargs.get("system_prompt") or "")
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "ok"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CaptureRuntime)
    router = _make_router()
    session = _make_session(context_files={})
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="cheng",
        user_input="你好",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert "### 用户引用的文件（context_files）" not in captured["system_prompt"]


@pytest.mark.asyncio
async def test_meta_pm_prompt_includes_context_file_body() -> None:
    abs_path = "/tmp/other-taskspace/MHS-notes.md"
    body = "PM_VISIBLE_TOKEN_99"
    captured: dict[str, str] = {}
    router = _make_router()

    async def stub_llm(**kwargs):
        captured["prompt"] = str(kwargs.get("prompt") or "")
        return "短结论。"

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(context_files={abs_path: body})
    session.__group_avatar_ids = []
    await router._run_meta_project_manager_reply(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Room",
        user_input="这份笔记的结论是什么",
    )
    prompt = captured["prompt"]
    assert f"--- {abs_path} ---" in prompt
    assert "PM_VISIBLE_TOKEN_99" in prompt
