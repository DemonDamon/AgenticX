#!/usr/bin/env python3
"""Smoke tests for subject-scoped workspace resolution.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from agenticx.avatar.group_chat import GroupChatRegistry
from agenticx.avatar.registry import AvatarRegistry
from agenticx.memory.graph.group_id import classify_subject, parse_subject
from agenticx.workspace.loader import ensure_group_workspace, resolve_subject_workspace_dir


def test_parse_subject_kinds() -> None:
    assert parse_subject("") == "meta"
    assert parse_subject(None) == "meta"
    assert parse_subject("abc123") == "avatar"
    assert parse_subject("group:gid1") == "group"
    assert classify_subject("group:gid1") == "group"


def test_resolve_subject_meta(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global_ws"
    global_ws.mkdir()
    monkeypatch.setattr(
        "agenticx.workspace.loader.resolve_workspace_dir",
        lambda: global_ws,
    )
    assert resolve_subject_workspace_dir(None) == global_ws.resolve()
    assert resolve_subject_workspace_dir("") == global_ws.resolve()


def test_resolve_subject_avatar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    avatars_root = tmp_path / "avatars"
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars_root)
    reg = AvatarRegistry(root=avatars_root)
    avatar = reg.create_avatar("Test Avatar", role="dev")
    resolved = resolve_subject_workspace_dir(avatar.id)
    assert resolved == Path(avatar.workspace_dir).resolve()


def test_ensure_group_workspace_lazy_create(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    groups_home = tmp_path / "agenticx" / "groups"
    monkeypatch.setattr(
        "agenticx.workspace.loader.DEFAULT_AGENTICX_HOME",
        tmp_path / "agenticx",
    )
    ws = ensure_group_workspace("grp001", group_name="研发群")
    assert ws.exists()
    assert (ws / "MEMORY.md").exists()
    assert (ws / "IDENTITY.md").exists()
    memory_text = (ws / "MEMORY.md").read_text(encoding="utf-8")
    assert "用户偏好（本群理解）" in memory_text
    identity_text = (ws / "IDENTITY.md").read_text(encoding="utf-8")
    assert "研发群" in identity_text


def test_resolve_subject_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    groups_root = tmp_path / "groups"
    monkeypatch.setattr("agenticx.avatar.group_chat.GROUPS_ROOT", groups_root)
    monkeypatch.setattr(
        "agenticx.workspace.loader.DEFAULT_AGENTICX_HOME",
        tmp_path,
    )
    reg = GroupChatRegistry(root=groups_root)
    group = reg.create_group("协作群", avatar_ids=[])
    resolved = resolve_subject_workspace_dir(f"group:{group.id}")
    assert resolved.name == "workspace"
    assert resolved.parent.name == group.id
    assert (resolved / "MEMORY.md").exists()
