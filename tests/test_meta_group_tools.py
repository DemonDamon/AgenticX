#!/usr/bin/env python3
"""Smoke tests for meta group-chat tools (list_avatars / create_group_chat).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime.meta_tools import META_AGENT_TOOLS, dispatch_meta_tool_async
from agenticx.runtime.team_manager import AgentTeamManager


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "ok"


@pytest.fixture()
def isolated_registries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect avatar/group registries and group workspace bootstrap to tmp."""
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path / "avatars")
    monkeypatch.setattr("agenticx.avatar.group_chat.GROUPS_ROOT", tmp_path / "groups")
    monkeypatch.setattr("agenticx.workspace.loader.DEFAULT_AGENTICX_HOME", tmp_path)
    return tmp_path


def _manager() -> AgentTeamManager:
    return AgentTeamManager(
        llm_factory=lambda: _QuickTextLLM(),
        base_session=StudioSession(),
    )


def _run(coro) -> str:
    return asyncio.run(coro)


def _create_avatar(name: str, role: str = "测试角色") -> dict:
    raw = _run(
        dispatch_meta_tool_async(
            "create_avatar",
            {"name": name, "role": role, "system_prompt": f"你是{name}"},
            team_manager=_manager(),
        )
    )
    return json.loads(raw)


def test_list_avatars_empty_and_fresh(isolated_registries: Path) -> None:
    raw = _run(dispatch_meta_tool_async("list_avatars", {}, team_manager=_manager()))
    data = json.loads(raw)
    assert data["ok"] is True
    assert data["count"] == 0
    assert data["avatars"] == []

    created = _create_avatar("程基岩", "游戏技术与引擎工程师")
    assert created["ok"] is True

    raw2 = _run(dispatch_meta_tool_async("list_avatars", {}, team_manager=_manager()))
    data2 = json.loads(raw2)
    assert data2["ok"] is True
    assert data2["count"] == 1
    entry = data2["avatars"][0]
    assert entry["avatar_id"] == created["avatar_id"]
    assert entry["name"] == "程基岩"
    assert entry["role"] == "游戏技术与引擎工程师"


def test_create_group_chat_by_names_and_ids(isolated_registries: Path) -> None:
    a1 = _create_avatar("游承峰")
    a2 = _create_avatar("文策渊")
    a3 = _create_avatar("程基岩")
    assert all(a["ok"] for a in (a1, a2, a3))

    raw = _run(
        dispatch_meta_tool_async(
            "create_group_chat",
            {
                "name": "游戏开发工作室",
                "members": ["游承峰", a2["avatar_id"], "程基岩", "游承峰"],
            },
            team_manager=_manager(),
        )
    )
    data = json.loads(raw)
    assert data["ok"] is True
    group = data["group"]
    assert group["name"] == "游戏开发工作室"
    assert group["avatar_ids"] == [a1["avatar_id"], a2["avatar_id"], a3["avatar_id"]]
    assert group["routing"] == "intelligent"
    assert data["resolved_members"] == ["游承峰", "文策渊", "程基岩"]
    assert data["unresolved"] == []

    from agenticx.avatar.group_chat import GroupChatRegistry

    persisted = GroupChatRegistry().get_group(group["id"])
    assert persisted is not None
    assert persisted.name == "游戏开发工作室"
    assert persisted.avatar_ids == [a1["avatar_id"], a2["avatar_id"], a3["avatar_id"]]


def test_create_group_chat_unresolved_members(isolated_registries: Path) -> None:
    a1 = _create_avatar("严守真")
    assert a1["ok"] is True

    raw_all_bad = _run(
        dispatch_meta_tool_async(
            "create_group_chat",
            {"name": "幽灵群", "members": ["不存在甲", "不存在乙"]},
            team_manager=_manager(),
        )
    )
    data_all_bad = json.loads(raw_all_bad)
    assert data_all_bad["ok"] is False
    assert data_all_bad["error"] == "members_unresolved"
    assert set(data_all_bad["unresolved"]) == {"不存在甲", "不存在乙"}
    names = {a["name"] for a in data_all_bad["available_avatars"]}
    assert "严守真" in names

    raw_partial = _run(
        dispatch_meta_tool_async(
            "create_group_chat",
            {"name": "部分成群", "members": ["严守真", "不存在丙"]},
            team_manager=_manager(),
        )
    )
    data_partial = json.loads(raw_partial)
    assert data_partial["ok"] is True
    assert data_partial["group"]["avatar_ids"] == [a1["avatar_id"]]
    assert data_partial["unresolved"] == ["不存在丙"]


def test_create_group_chat_idempotent_same_membership(isolated_registries: Path) -> None:
    a1 = _create_avatar("路远行")
    a2 = _create_avatar("林绘澄")
    assert a1["ok"] and a2["ok"]

    args = {"name": "运营发行组", "members": ["路远行", "林绘澄"]}
    first = json.loads(_run(dispatch_meta_tool_async("create_group_chat", args, team_manager=_manager())))
    second = json.loads(_run(dispatch_meta_tool_async("create_group_chat", args, team_manager=_manager())))
    assert first["ok"] is True and "existing" not in first
    assert second["ok"] is True
    assert second.get("existing") is True
    assert second["group"]["id"] == first["group"]["id"]

    third = json.loads(
        _run(
            dispatch_meta_tool_async(
                "create_group_chat",
                {"name": "运营发行组", "members": ["路远行"]},
                team_manager=_manager(),
            )
        )
    )
    assert third["ok"] is True
    assert "existing" not in third
    assert third["group"]["id"] != first["group"]["id"]


def test_create_group_chat_validation(isolated_registries: Path) -> None:
    missing_name = json.loads(
        _run(dispatch_meta_tool_async("create_group_chat", {"members": ["x"]}, team_manager=_manager()))
    )
    assert missing_name["ok"] is False
    assert missing_name["error"] == "missing_name"

    missing_members = json.loads(
        _run(dispatch_meta_tool_async("create_group_chat", {"name": "空群"}, team_manager=_manager()))
    )
    assert missing_members["ok"] is False
    assert missing_members["error"] == "missing_members"

    bad_routing = json.loads(
        _run(
            dispatch_meta_tool_async(
                "create_group_chat",
                {"name": "错路由", "members": ["x"], "routing": "chaos"},
                team_manager=_manager(),
            )
        )
    )
    assert bad_routing["ok"] is False
    assert bad_routing["error"] == "invalid_routing"


def test_meta_tool_specs_registered() -> None:
    specs = {
        t.get("function", {}).get("name"): t.get("function", {})
        for t in META_AGENT_TOOLS
        if isinstance(t, dict)
    }
    assert "list_avatars" in specs
    assert "create_group_chat" in specs
    create_spec = specs["create_group_chat"]
    assert set(create_spec["parameters"]["required"]) == {"name", "members"}
    member_schema = create_spec["parameters"]["properties"]["members"]
    assert member_schema["type"] == "array"
