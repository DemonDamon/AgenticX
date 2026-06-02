#!/usr/bin/env python3
"""Smoke tests for optional avatar workspace_dir at creation.

Verifies that AvatarRegistry.create_avatar honors a user-provided
workspace_dir when non-empty, and falls back to the per-avatar default
when omitted (backward compatible).

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.avatar.registry import AvatarRegistry


def test_create_avatar_default_workspace(tmp_path: Path) -> None:
    registry = AvatarRegistry(root=tmp_path / "avatars")
    config = registry.create_avatar(name="Default")
    expected = (tmp_path / "avatars" / config.id / "workspace").resolve()
    assert Path(config.workspace_dir) == expected
    assert Path(config.workspace_dir).is_dir()


def test_create_avatar_custom_workspace(tmp_path: Path) -> None:
    registry = AvatarRegistry(root=tmp_path / "avatars")
    custom = tmp_path / "custom_ws"
    config = registry.create_avatar(name="Custom", workspace_dir=str(custom))
    assert Path(config.workspace_dir) == custom.resolve()
    assert Path(config.workspace_dir).is_dir()
    # Custom dir must NOT be nested under the per-avatar default root.
    assert config.id not in str(config.workspace_dir)


def test_create_avatar_blank_workspace_falls_back(tmp_path: Path) -> None:
    registry = AvatarRegistry(root=tmp_path / "avatars")
    config = registry.create_avatar(name="Blank", workspace_dir="   ")
    expected = (tmp_path / "avatars" / config.id / "workspace").resolve()
    assert Path(config.workspace_dir) == expected


def test_custom_workspace_expanduser(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    registry = AvatarRegistry(root=tmp_path / "avatars")
    config = registry.create_avatar(name="Tilde", workspace_dir="~/my_avatar_ws")
    assert Path(config.workspace_dir) == (tmp_path / "my_avatar_ws").resolve()
