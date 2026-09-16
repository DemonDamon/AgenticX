#!/usr/bin/env python3
"""Smoke tests for conversational avatar identity updates.

Covers update_self_identity dispatch into AvatarRegistry and the
avatar-block prompt rule that tells the model to call the tool.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from agenticx.avatar.registry import AvatarRegistry
from agenticx.runtime.meta_tools import META_AGENT_TOOLS, dispatch_meta_tool_async
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.runtime.team_manager import AgentTeamManager
from agenticx.studio.session_manager import StudioSession


def _tool_names() -> set[str]:
    names: set[str] = set()
    for item in META_AGENT_TOOLS:
        if not isinstance(item, dict):
            continue
        fn = item.get("function")
        if isinstance(fn, dict):
            name = str(fn.get("name") or "").strip()
            if name:
                names.add(name)
    return names


def _tmp_registry_cls(root: Path) -> type[AvatarRegistry]:
    class _TmpRegistry(AvatarRegistry):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(root=root)

    return _TmpRegistry


def test_update_self_identity_registered_in_meta_tools() -> None:
    assert "update_self_identity" in _tool_names()


@pytest.mark.asyncio
async def test_update_self_identity_renames_and_updates_role(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "avatars"
    registry_cls = _tmp_registry_cls(root)
    monkeypatch.setattr("agenticx.avatar.registry.AvatarRegistry", registry_cls)

    registry = registry_cls()
    avatar = registry.create_avatar(name="oo", role="General Assistant")
    session = MagicMock()
    session.bound_avatar_id = avatar.id

    team = AgentTeamManager.__new__(AgentTeamManager)
    result = json.loads(
        await dispatch_meta_tool_async(
            "update_self_identity",
            {"name": "售前专家", "role": "AI 项目售前专家"},
            team_manager=team,
            session=session,
        )
    )
    assert result["ok"] is True
    assert result["renamed"] is True
    assert result["previous_name"] == "oo"
    assert result["name"] == "售前专家"
    assert result["role"] == "AI 项目售前专家"
    assert result["avatar_id"] == avatar.id

    loaded = registry_cls().get_avatar(avatar.id)
    assert loaded is not None
    assert loaded.name == "售前专家"
    assert loaded.role == "AI 项目售前专家"


@pytest.mark.asyncio
async def test_update_self_identity_rejects_name_taken(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "avatars"
    registry_cls = _tmp_registry_cls(root)
    monkeypatch.setattr("agenticx.avatar.registry.AvatarRegistry", registry_cls)

    registry = registry_cls()
    first = registry.create_avatar(name="oo", role="a")
    other = registry.create_avatar(name="售前专家", role="b")
    session = MagicMock()
    session.bound_avatar_id = first.id

    team = AgentTeamManager.__new__(AgentTeamManager)
    result = json.loads(
        await dispatch_meta_tool_async(
            "update_self_identity",
            {"name": "售前专家", "role": "AI 项目售前专家"},
            team_manager=team,
            session=session,
        )
    )
    assert result["ok"] is False
    assert result["error"] == "name_taken"
    loaded = registry_cls().get_avatar(first.id)
    assert loaded is not None
    assert loaded.name == "oo"
    assert other.name == "售前专家"


@pytest.mark.asyncio
async def test_update_self_identity_rejects_empty_and_group_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "avatars"
    registry_cls = _tmp_registry_cls(root)
    monkeypatch.setattr("agenticx.avatar.registry.AvatarRegistry", registry_cls)

    team = AgentTeamManager.__new__(AgentTeamManager)
    empty = MagicMock()
    empty.bound_avatar_id = ""
    empty_result = json.loads(
        await dispatch_meta_tool_async(
            "update_self_identity",
            {"name": "kimi"},
            team_manager=team,
            session=empty,
        )
    )
    assert empty_result["ok"] is False
    assert empty_result["error"] == "not_an_avatar_pane"

    group = MagicMock()
    group.bound_avatar_id = "group:abc"
    group_result = json.loads(
        await dispatch_meta_tool_async(
            "update_self_identity",
            {"name": "kimi"},
            team_manager=team,
            session=group,
        )
    )
    assert group_result["ok"] is False
    assert group_result["error"] == "not_an_avatar_pane"


def test_avatar_prompt_requires_update_self_identity() -> None:
    session = StudioSession()
    with_avatar = build_meta_agent_system_prompt(
        session,
        avatar_context={"name": "oo", "role": "General Assistant"},
        include_volatile=False,
    )
    assert "update_self_identity" in with_avatar

    meta_only = build_meta_agent_system_prompt(session, include_volatile=False)
    assert "update_self_identity" not in meta_only
