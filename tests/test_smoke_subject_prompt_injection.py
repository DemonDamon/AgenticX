#!/usr/bin/env python3
"""Smoke tests for subject-scoped workspace prompt injection.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agenticx.avatar.registry import AvatarRegistry
from agenticx.runtime.prompts.meta_agent import _build_workspace_context_block


def test_prompt_includes_global_user_and_avatar_memory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    (global_ws / "USER.md").write_text("全局偏好：简洁中文", encoding="utf-8")
    (global_ws / "IDENTITY.md").write_text("Meta identity", encoding="utf-8")
    (global_ws / "MEMORY.md").write_text("Meta memory anchor", encoding="utf-8")

    avatars_root = tmp_path / "avatars"
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars_root)
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    reg = AvatarRegistry(root=avatars_root)
    avatar = reg.create_avatar("Coder", role="dev")
    avatar_ws = Path(avatar.workspace_dir)
    (avatar_ws / "MEMORY.md").write_text("分身记忆：只用 Rust", encoding="utf-8")

    session = MagicMock()
    session.bound_avatar_id = avatar.id

    block = _build_workspace_context_block(avatar.id, session=session, subject_label="Coder")
    assert "全局用户偏好（只读基线）" in block
    assert "简洁中文" in block
    assert "只用 Rust" in block
    assert "Meta memory anchor" not in block


def test_meta_prompt_dedupes_global_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    global_ws = tmp_path / "global"
    global_ws.mkdir()
    (global_ws / "USER.md").write_text("全局偏好", encoding="utf-8")
    (global_ws / "MEMORY.md").write_text("元智能体记忆", encoding="utf-8")
    monkeypatch.setattr("agenticx.workspace.loader.resolve_workspace_dir", lambda: global_ws)

    block = _build_workspace_context_block(None, subject_label="元智能体")
    assert block.count("元智能体记忆") == 1
    assert "全局用户偏好（只读基线）" in block
