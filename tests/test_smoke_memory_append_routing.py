#!/usr/bin/env python3
"""Smoke tests for subject-scoped memory_append and search routing.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.agent_tools import _tool_memory_append
from agenticx.memory.graph.config import MemoryGraphConfig
from agenticx.memory.recall import search_memory_for_chat
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.meta_tools import dispatch_meta_tool_async
from agenticx.workspace.loader import resolve_workspace_dir


@pytest.mark.asyncio
async def test_memory_append_routes_to_avatar_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    (global_ws / "USER.md").write_text("# USER\n", encoding="utf-8")
    (global_ws / "MEMORY.md").write_text("# MEMORY\n", encoding="utf-8")

    avatars_root = tmp_path / "avatars"
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars_root)
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    reg = AvatarRegistry(root=avatars_root)
    avatar = reg.create_avatar("Avatar A", role="dev")

    session = MagicMock()
    session.bound_avatar_id = avatar.id

    gate = AsyncMock(return_value=True)
    result = await _tool_memory_append(
        {"target": "long_term", "content": "用户喜欢 TypeScript", "scope": "subject"},
        confirm_gate=gate,
        emit_event=None,
        session=session,
    )
    assert "OK" in result

    avatar_memory = Path(avatar.workspace_dir) / "MEMORY.md"
    assert "TypeScript" in avatar_memory.read_text(encoding="utf-8")
    assert "TypeScript" not in (global_ws / "MEMORY.md").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_memory_append_user_global_writes_user_md(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    (global_ws / "USER.md").write_text(
        "# USER.md\n- Preferences:\n  - Chinese replies\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    session = MagicMock()
    session.bound_avatar_id = ""

    gate = AsyncMock(return_value=True)
    result = await _tool_memory_append(
        {
            "target": "long_term",
            "content": "所有分身都要避免直接 rm -rf",
            "scope": "user_global",
        },
        confirm_gate=gate,
        emit_event=None,
        session=session,
    )
    assert "OK" in result
    user_text = (global_ws / "USER.md").read_text(encoding="utf-8")
    assert "rm -rf" in user_text


@pytest.mark.asyncio
async def test_memory_search_does_not_leak_other_avatar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    (global_ws / "USER.md").write_text("# USER\n", encoding="utf-8")

    avatars_root = tmp_path / "avatars"
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars_root)
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    reg = AvatarRegistry(root=avatars_root)
    avatar_a = reg.create_avatar("A", role="a")
    avatar_b = reg.create_avatar("B", role="b")

    ws_a = Path(avatar_a.workspace_dir)
    ws_b = Path(avatar_b.workspace_dir)
    (ws_a / "MEMORY.md").write_text("# MEMORY\n- uniquealphatoken\n", encoding="utf-8")
    (ws_b / "MEMORY.md").write_text("# MEMORY\n- uniquebetatoken\n", encoding="utf-8")

    db_path = tmp_path / "main.sqlite"
    store = WorkspaceMemoryStore(db_path)
    store.index_workspace_sync(global_ws)
    store.index_workspace_sync(ws_a)
    store.index_workspace_sync(ws_b)

    cfg = MemoryGraphConfig(enabled=False, search_in_chat=True)

    with patch("agenticx.memory.recall.WorkspaceMemoryStore", return_value=store):
        with patch("agenticx.memory.graph.config.load_memory_graph_config", return_value=cfg):
            result = await search_memory_for_chat(
                "uniquebetatoken",
                limit=5,
                avatar_id=avatar_a.id,
            )

    texts = [row.get("text", "") for row in result.matches]
    joined = "\n".join(texts)
    assert "uniquebetatoken" not in joined


@pytest.mark.asyncio
async def test_meta_tools_memory_append_group_scope(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    monkeypatch.setattr("agenticx.workspace.loader.DEFAULT_AGENTICX_HOME", tmp_path / "agenticx")
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    from agenticx.avatar.group_chat import GroupChatRegistry

    groups_root = tmp_path / "agenticx" / "groups"
    reg = GroupChatRegistry(root=groups_root)
    group = reg.create_group("协作群", avatar_ids=[])

    session = MagicMock()
    session.bound_avatar_id = f"group:{group.id}"
    session.session_id = "sess-1"

    raw = await dispatch_meta_tool_async(
        "memory_append",
        {"target": "long_term", "content": "本群默认中文产出", "scope": "subject"},
        session=session,
        team_manager=MagicMock(),
    )
    payload = json.loads(raw)
    assert payload.get("ok") is True
    group_memory = groups_root / group.id / "workspace" / "MEMORY.md"
    assert group_memory.exists()
    assert "中文产出" in group_memory.read_text(encoding="utf-8")
