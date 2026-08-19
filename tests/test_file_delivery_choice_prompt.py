#!/usr/bin/env python3
"""Tests for the interactive-only file-delivery choice prompt."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.prompts.file_delivery import (
    FILE_DELIVERY_CHOICE_PROMPT_MARKER,
    build_file_delivery_choice_prompt_block,
    has_file_delivery_choice_prompt_block,
)
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt


class _Response:
    content = "ok"
    tool_calls: list[dict[str, Any]] = []


class _NoopLLM:
    def invoke(self, *_args: Any, **_kwargs: Any) -> _Response:
        return _Response()

    async def ainvoke(self, *_args: Any, **_kwargs: Any) -> _Response:
        return _Response()

    def stream(self, *_args: Any, **_kwargs: Any):
        yield "ok"


def test_delivery_choice_builder_is_narrow_and_actionable() -> None:
    block = build_file_delivery_choice_prompt_block()

    assert block.count(FILE_DELIVERY_CHOICE_PROMPT_MARKER) == 1
    assert "request_clarification" in block
    assert '"id":"delivery_mode"' in block
    assert "直接在对话中给出" in block
    assert "生成文件（按内容选择合适格式）" in block
    assert "只在对话中回答" in block
    assert "已指定格式或路径" in block
    assert "代码或仓库修改" in block
    assert "同一交付物只问一次" in block
    assert "confirm_required" in block
    assert "request_action_confirmation" in block
    assert "automation/unattended" in block
    assert has_file_delivery_choice_prompt_block(block) is True
    assert has_file_delivery_choice_prompt_block(None) is False
    assert has_file_delivery_choice_prompt_block("文件交付方式选择") is False


def test_full_meta_prompt_requires_explicit_delivery_choice_opt_in() -> None:
    session = StudioSession()
    default_prompt = build_meta_agent_system_prompt(session, taskspaces=[])
    opted_in_prompt = build_meta_agent_system_prompt(
        session,
        taskspaces=[],
        include_file_delivery_choice=True,
    )

    assert FILE_DELIVERY_CHOICE_PROMPT_MARKER not in default_prompt
    assert opted_in_prompt.count(FILE_DELIVERY_CHOICE_PROMPT_MARKER) == 1
    assert opted_in_prompt.index(FILE_DELIVERY_CHOICE_PROMPT_MARKER) < opted_in_prompt.index(
        "## 向用户提问（human-in-the-loop）"
    )


def _build_capture_client(monkeypatch, tmp_path: Path):
    from agenticx.avatar.group_chat import GroupChatRegistry
    from agenticx.avatar.registry import AvatarRegistry
    from agenticx.memory import session_store as session_store_module
    from agenticx.studio import server as server_module

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        session_store_module,
        "DEFAULT_SESSION_DB_PATH",
        tmp_path / "memory" / "sessions.sqlite",
    )
    monkeypatch.setattr(
        server_module,
        "AvatarRegistry",
        lambda: AvatarRegistry(tmp_path / "avatars"),
    )
    monkeypatch.setattr(
        server_module,
        "GroupChatRegistry",
        lambda: GroupChatRegistry(tmp_path / "groups"),
    )
    monkeypatch.setattr(
        server_module.ProviderResolver,
        "resolve",
        lambda **_kwargs: _NoopLLM(),
    )

    chat_prompts: list[str] = []
    loop_prompts: list[str] = []

    class _CaptureRuntime:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        async def run_turn(self, *_args: Any, **kwargs: Any):
            chat_prompts.append(str(kwargs.get("system_prompt") or ""))
            yield RuntimeEvent(
                type=EventType.FINAL.value,
                data={"text": "ok"},
                agent_id="meta",
            )

    class _CaptureLoopController:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        async def run_loop(self, **kwargs: Any):
            loop_prompts.append(str(kwargs.get("system_prompt") or ""))
            yield RuntimeEvent(
                type=EventType.FINAL.value,
                data={"text": "ok"},
                agent_id="meta",
            )

    monkeypatch.setattr(server_module, "AgentRuntime", _CaptureRuntime)
    monkeypatch.setattr(server_module, "LoopController", _CaptureLoopController)

    app = server_module.create_studio_app()
    return TestClient(app), app, chat_prompts, loop_prompts


def test_studio_attaches_rule_only_to_interactive_chat_paths(monkeypatch, tmp_path) -> None:
    client, app, chat_prompts, loop_prompts = _build_capture_client(monkeypatch, tmp_path)

    meta_session_id = client.get("/api/session").json()["session_id"]
    meta_response = client.post(
        "/api/chat",
        json={"session_id": meta_session_id, "user_input": "写一份完整报告"},
    )
    assert meta_response.status_code == 200
    assert chat_prompts[-1].count(FILE_DELIVERY_CHOICE_PROMPT_MARKER) == 1

    unattended_meta_response = client.post(
        "/api/chat",
        json={
            "session_id": meta_session_id,
            "user_input": "后台继续生成报告",
            "unattended_run": True,
        },
    )
    assert unattended_meta_response.status_code == 200
    assert FILE_DELIVERY_CHOICE_PROMPT_MARKER not in chat_prompts[-1]

    avatar = app.state.avatar_registry.create_avatar(name="测试专家", role="Researcher")
    avatar_session = client.post("/api/sessions", json={"avatar_id": avatar.id})
    assert avatar_session.status_code == 200
    avatar_response = client.post(
        "/api/chat",
        json={
            "session_id": avatar_session.json()["session_id"],
            "user_input": "写一份完整报告",
        },
    )
    assert avatar_response.status_code == 200
    assert "你是 AgenticX 分身 **测试专家**" in chat_prompts[-1]
    assert chat_prompts[-1].count(FILE_DELIVERY_CHOICE_PROMPT_MARKER) == 1

    unattended_avatar_response = client.post(
        "/api/chat",
        json={
            "session_id": avatar_session.json()["session_id"],
            "user_input": "后台继续生成报告",
            "unattended_run": True,
        },
    )
    assert unattended_avatar_response.status_code == 200
    assert FILE_DELIVERY_CHOICE_PROMPT_MARKER not in chat_prompts[-1]

    automation_session = client.post(
        "/api/sessions",
        json={"avatar_id": "automation:test-delivery-choice"},
    )
    assert automation_session.status_code == 200
    automation_response = client.post(
        "/api/chat",
        json={
            "session_id": automation_session.json()["session_id"],
            "user_input": "执行定时报告任务",
        },
    )
    assert automation_response.status_code == 200
    assert "# 定时 / 自动化任务执行器" in chat_prompts[-1]
    assert FILE_DELIVERY_CHOICE_PROMPT_MARKER not in chat_prompts[-1]

    loop_response = client.post(
        "/api/loop",
        json={
            "session_id": meta_session_id,
            "user_input": "继续迭代",
            "max_iterations": 1,
        },
    )
    assert loop_response.status_code == 200
    assert loop_prompts
    assert FILE_DELIVERY_CHOICE_PROMPT_MARKER not in loop_prompts[-1]
