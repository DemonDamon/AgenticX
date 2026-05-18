#!/usr/bin/env python3
"""Smoke tests for delegation paused-state propagation (FR-1).

Verifies that when the avatar runtime emits ``SUBAGENT_PAUSED`` (because
``max_tool_rounds`` was hit), ``_run_delegation_in_avatar_session`` records
``status="paused"`` in ``_delegation_info`` and surfaces a ``SUBAGENT_PAUSED``
team event, instead of silently coercing the run into ``"completed"``.

Plan-Id: 2026-05-18-long-task-feedback-transparency

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import types
from typing import Any, Dict, List, Optional

import pytest

from agenticx.runtime import meta_tools
from agenticx.runtime.events import EventType, RuntimeEvent


class _FakeStudioSession:
    def __init__(self) -> None:
        self.workspace_dir = ""
        self.taskspaces: List[Dict[str, Any]] = []
        self.context_files: Dict[str, Any] = {}
        self.provider_name = "openai"
        self.model_name = "gpt-4o-mini"
        self.agent_messages: List[Dict[str, Any]] = []
        self.chat_history: List[Dict[str, Any]] = []
        self.artifacts: List[Any] = []


class _FakeAvatarManaged:
    def __init__(self) -> None:
        self.studio_session = _FakeStudioSession()
        self.session_id = "avatar-session-1"
        self.avatar_id = "avatar-1"
        self.avatar_name = "Coder"
        self.taskspaces: List[Dict[str, Any]] = []
        self.updated_at = 0.0
        self._delegation_info: Optional[Dict[str, Any]] = None

    def get_confirm_gate(self, _: str) -> Any:
        return object()

    def get_or_create_team(self, **_: Any) -> Any:
        return object()


class _FakeAvatarConfig:
    def __init__(self) -> None:
        self.id = "avatar-1"
        self.name = "Coder"
        self.role = "Engineer"
        self.system_prompt = ""
        self.default_provider = "openai"
        self.default_model = "gpt-4o-mini"
        self.workspace_dir = ""


class _FakeSessionManager:
    def persist(self, _: str) -> None:
        return None


class _FakeTeamManager:
    def __init__(self) -> None:
        self.emitted: List[RuntimeEvent] = []

    async def _emit(self, event: RuntimeEvent) -> None:
        self.emitted.append(event)


class _FakeRuntime:
    """Stand-in for ``AgentRuntime`` whose ``run_turn`` only yields a paused event."""

    def __init__(self, *_: Any, **__: Any) -> None:
        pass

    async def run_turn(self, *_: Any, **__: Any):  # type: ignore[no-untyped-def]
        yield RuntimeEvent(
            type=EventType.SUBAGENT_PAUSED.value,
            data={
                "agent_id": "delegation-1",
                "round": 60,
                "max_rounds": 60,
                "text": "已达到最大工具调用轮数，已暂停自动执行。",
                "executed_tools": ["bash_exec", "file_read", "todo_write"],
            },
            agent_id="delegation-1",
        )


class _FakeCompletedMissingFileRuntime:
    """Runtime that reports a file write to a path that does not exist."""

    def __init__(self, *_: Any, **__: Any) -> None:
        pass

    async def run_turn(self, *_args: Any, **__: Any):  # type: ignore[no-untyped-def]
        avatar_session = _args[1]
        avatar_session.agent_messages.append(
            {
                "role": "tool",
                "name": "file_write",
                "content": "OK: wrote /tmp/agenticx-missing-output-for-test.md (10 chars)",
            }
        )
        yield RuntimeEvent(
            type=EventType.FINAL.value,
            data={"text": "文档已写入。"},
            agent_id="delegation-1",
        )


@pytest.fixture
def patched_meta_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(meta_tools, "ProviderResolver", types.SimpleNamespace(resolve=lambda **_: object()))

    # _run_delegation_in_avatar_session imports AgentRuntime / EventType lazily
    # inside the function body. Patch the real AgentRuntime symbol so the
    # function body picks up our fake.
    import agenticx.runtime.agent_runtime as agent_runtime_module

    monkeypatch.setattr(agent_runtime_module, "AgentRuntime", _FakeRuntime)


def test_delegation_paused_status_is_recorded(patched_meta_tools: None) -> None:
    """SUBAGENT_PAUSED event must surface as status=paused, not silently completed."""
    avatar_managed = _FakeAvatarManaged()
    avatar_config = _FakeAvatarConfig()
    session_manager = _FakeSessionManager()
    team_manager = _FakeTeamManager()
    cancel_event = asyncio.Event()
    scratchpad: Dict[str, Any] = {}

    asyncio.run(
        meta_tools._run_delegation_in_avatar_session(
            avatar_managed=avatar_managed,
            avatar_config=avatar_config,
            task="跑一个长任务",
            meta_scratchpad=scratchpad,
            delegation_id="delegation-1",
            session_manager=session_manager,
            cancel_event=cancel_event,
            meta_team_manager=team_manager,  # type: ignore[arg-type]
        )
    )

    info = avatar_managed._delegation_info or {}
    assert info.get("status") == "paused", f"expected paused, got {info!r}"
    assert info.get("paused_round") == 60
    assert info.get("paused_max_rounds") == 60
    assert "bash_exec" in (info.get("paused_executed_tools") or [])
    # Summary must mention saturation so Meta does not assume a clean completion.
    assert "暂停" in str(info.get("summary", ""))

    # Team manager must receive a SUBAGENT_PAUSED event (FR-1 wiring), not
    # SUBAGENT_COMPLETED / SUBAGENT_ERROR.
    assert any(ev.type == EventType.SUBAGENT_PAUSED.value for ev in team_manager.emitted), (
        f"expected SUBAGENT_PAUSED event, got {[ev.type for ev in team_manager.emitted]}"
    )

    # Pending summaries surfaced to Meta scratchpad must reflect paused state.
    pending = scratchpad.get("__pending_subagent_summaries__", [])
    assert pending and "状态=paused" in pending[-1]


def test_delegation_missing_file_artifact_fails_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    """A document task must not be marked completed when its reported output path is missing."""
    monkeypatch.setattr(meta_tools, "ProviderResolver", types.SimpleNamespace(resolve=lambda **_: object()))

    import agenticx.runtime.agent_runtime as agent_runtime_module

    monkeypatch.setattr(agent_runtime_module, "AgentRuntime", _FakeCompletedMissingFileRuntime)

    avatar_managed = _FakeAvatarManaged()
    avatar_config = _FakeAvatarConfig()
    session_manager = _FakeSessionManager()
    team_manager = _FakeTeamManager()
    scratchpad: Dict[str, Any] = {}

    asyncio.run(
        meta_tools._run_delegation_in_avatar_session(
            avatar_managed=avatar_managed,
            avatar_config=avatar_config,
            task="请写入 /tmp/agenticx-missing-output-for-test.md",
            meta_scratchpad=scratchpad,
            delegation_id="delegation-1",
            session_manager=session_manager,
            cancel_event=asyncio.Event(),
            meta_team_manager=team_manager,  # type: ignore[arg-type]
        )
    )

    info = avatar_managed._delegation_info or {}
    assert info.get("status") == "failed", f"expected failed validation, got {info!r}"
    assert "路径不存在" in str(info.get("error", ""))
    assert any(ev.type == EventType.SUBAGENT_ERROR.value for ev in team_manager.emitted)
