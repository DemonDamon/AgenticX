#!/usr/bin/env python3
"""Runtime discipline for group work items.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import agenticx.runtime.work_items as work_items
from agenticx.cli.studio import StudioSession
from agenticx.runtime.group_router import (
    GROUP_MEMBER_BLOCKED_TOOLS,
    GroupChatRouter,
    META_LEADER_AGENT_ID,
    _group_chat_tools,
)
from agenticx.runtime.meta_tools import dispatch_meta_tool_async
from agenticx.runtime.team_manager import AgentTeamManager
from agenticx.runtime.work_items import (
    WorkItemStore,
    build_work_items_prompt_block,
    get_work_item_store,
)


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
def isolated_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> WorkItemStore:
    root = tmp_path / "groups"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(work_items, "_groups_root", lambda: root)
    return WorkItemStore()


def _make_router() -> GroupChatRouter:
    avatars = {
        "wen": MagicMock(name="文策渊"),
        "cheng": MagicMock(name="程基岩"),
    }
    avatars["wen"].name = "文策渊"
    avatars["cheng"].name = "程基岩"
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )


def _manager() -> AgentTeamManager:
    return AgentTeamManager(
        llm_factory=lambda: _QuickTextLLM(),
        base_session=StudioSession(),
    )


def test_prompt_block_lists_open_item(isolated_store: WorkItemStore) -> None:
    item = isolated_store.create_item("g-prompt", title="方案第一节")
    block = build_work_items_prompt_block("g-prompt")
    assert item.id in block
    assert "方案第一节" in block
    assert "不能把事项标为 accepted" in block


def test_prompt_block_empty_group(isolated_store: WorkItemStore) -> None:
    assert build_work_items_prompt_block("g-empty") == ""
    assert build_work_items_prompt_block("") == ""


def test_group_member_tools_hide_scheduler_tools() -> None:
    names = {t["function"]["name"] for t in _group_chat_tools() if isinstance(t.get("function"), dict)}
    assert names.isdisjoint(GROUP_MEMBER_BLOCKED_TOOLS)
    assert "delegate_to_avatar" not in names
    assert "file_read" in names or "bash_exec" in names


def test_auto_dispatch_skips_paused_owner_unless_mentioned(isolated_store: WorkItemStore) -> None:
    item = isolated_store.create_item(
        "g-pause-rt",
        title="暂停事项",
        owner_kind="avatar",
        owner_id="wen",
    )
    isolated_store.pause("g-pause-rt", item.id, expected_version=item.version)
    router = _make_router()
    run_ids, skips = router._filter_dispatch_targets(
        group_id="g-pause-rt",
        targets=["wen", META_LEADER_AGENT_ID, "cheng"],
        mentioned_avatar_ids=[],
    )
    assert "wen" not in run_ids
    assert META_LEADER_AGENT_ID in run_ids
    assert "cheng" in run_ids
    assert any(s.agent_id == "wen" and s.event_type == "group_progress" for s in skips)

    run_ids2, skips2 = router._filter_dispatch_targets(
        group_id="g-pause-rt",
        targets=["wen", META_LEADER_AGENT_ID],
        mentioned_avatar_ids=["wen"],
    )
    assert "wen" in run_ids2
    assert META_LEADER_AGENT_ID in run_ids2
    assert skips2 == []


def test_meta_tool_create_and_cannot_accept(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", tmp_path / "avatars")
    monkeypatch.setattr("agenticx.avatar.group_chat.GROUPS_ROOT", tmp_path / "groups")
    monkeypatch.setattr(work_items, "_groups_root", lambda: tmp_path / "groups")
    from agenticx.avatar.group_chat import GroupChatRegistry
    from agenticx.avatar.registry import AvatarRegistry

    avatar = AvatarRegistry().create_avatar(name="文策渊", role="策划")
    group = GroupChatRegistry().create_group(name="项目群", avatar_ids=[avatar.id])
    session = StudioSession()
    setattr(session, "avatar_id", f"group:{group.id}")
    created_raw = asyncio.run(
        dispatch_meta_tool_async(
            "work_item_upsert",
            {"action": "create", "title": "方案第一节", "owner_kind": "avatar", "owner_id": avatar.id},
            team_manager=_manager(),
            session=session,
        )
    )
    created = json.loads(created_raw)
    assert created["ok"] is True
    item_id = created["item"]["id"]
    denied = json.loads(
        asyncio.run(
            dispatch_meta_tool_async(
                "work_item_upsert",
                {"action": "accept", "item_id": item_id, "expected_version": created["item"]["version"]},
                team_manager=_manager(),
                session=session,
            )
        )
    )
    assert denied["ok"] is False
    assert "unsupported" in str(denied.get("error") or "")
    stored = get_work_item_store().get_item(group.id, item_id)
    assert stored is not None
    assert stored.status != "accepted"


def test_submit_owner_delivery_promotes_and_submits(
    isolated_store: WorkItemStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.runtime.work_items import submit_owner_delivery

    monkeypatch.setattr(work_items, "get_work_item_store", lambda: isolated_store)
    item = isolated_store.create_item(
        "g-deliver",
        title="统一模型调用协议",
        owner_kind="avatar",
        owner_id="beichen",
    )
    isolated_store.mark_in_progress("g-deliver", item.id, expected_version=item.version)
    src = tmp_path / "taskspace" / "model-api-contract.md"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text("# contract\n", encoding="utf-8")

    submitted = submit_owner_delivery("g-deliver", "beichen", [str(src)])
    assert submitted is not None
    assert submitted.status == "submitted"
    assert submitted.artifact_paths
    dest = Path(submitted.artifact_paths[0])
    assert dest.is_file()
    assert dest.name == "model-api-contract.md"
    assert "groups" in dest.parts
    assert dest.read_text(encoding="utf-8") == "# contract\n"
    stored = isolated_store.get_item("g-deliver", item.id)
    assert stored is not None
    assert stored.status == "submitted"


def test_submit_owner_delivery_skips_without_files_or_progress(
    isolated_store: WorkItemStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.runtime.work_items import submit_owner_delivery

    monkeypatch.setattr(work_items, "get_work_item_store", lambda: isolated_store)
    open_item = isolated_store.create_item(
        "g-skip",
        title="还没开工",
        owner_kind="avatar",
        owner_id="qingkong",
    )
    assert submit_owner_delivery("g-skip", "qingkong", []) is None
    src = tmp_path / "note.md"
    src.write_text("draft", encoding="utf-8")
    assert submit_owner_delivery("g-skip", "qingkong", [str(src)]) is None
    assert isolated_store.get_item("g-skip", open_item.id).status == "open"

    progressing = isolated_store.mark_in_progress(
        "g-skip", open_item.id, expected_version=open_item.version
    )
    assert submit_owner_delivery("g-skip", "other-owner", [str(src)]) is None
    assert isolated_store.get_item("g-skip", progressing.id).status == "in_progress"


def test_meta_tool_rejected_outside_group() -> None:
    session = StudioSession()
    setattr(session, "avatar_id", "plain-avatar")
    raw = asyncio.run(
        dispatch_meta_tool_async(
            "work_item_upsert",
            {"action": "create", "title": "不该创建"},
            team_manager=_manager(),
            session=session,
        )
    )
    data = json.loads(raw)
    assert data["ok"] is False
    assert "群聊" in str(data.get("error") or "")
