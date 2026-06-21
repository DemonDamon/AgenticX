#!/usr/bin/env python3
"""Tests for canonical meta-agent session workspace resolution."""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.studio.session_manager import ManagedSession, SessionManager
from agenticx.workspace.loader import resolve_default_session_workspace_dir


def test_resolve_default_session_workspace_dir_uses_config_default(
    tmp_path: Path,
    monkeypatch,
) -> None:
    canonical = tmp_path / "from-config"
    canonical.mkdir()
    monkeypatch.delenv("AGX_WORKSPACE_ROOT", raising=False)
    monkeypatch.setattr(
        "agenticx.workspace.loader.resolve_workspace_dir",
        lambda: canonical,
    )
    assert resolve_default_session_workspace_dir() == canonical


def test_resolve_default_session_workspace_dir_prefers_avatar(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    avatar_ws = tmp_path / "avatar-ws"
    avatar_ws.mkdir()
    assert resolve_default_session_workspace_dir(
        avatar_workspace_dir=str(avatar_ws),
    ) == avatar_ws.resolve()


def test_resolve_default_session_workspace_dir_env_override(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    override = tmp_path / "override-ws"
    override.mkdir()
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(override))
    assert resolve_default_session_workspace_dir() == override.resolve()


def test_align_meta_session_workspace_migrates_home_dir(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    canonical = tmp_path / "meta-ws"
    canonical.mkdir()
    monkeypatch.setattr(
        "agenticx.workspace.loader.resolve_default_session_workspace_dir",
        lambda **kwargs: canonical.resolve(),
    )
    manager = SessionManager()
    managed = ManagedSession(
        session_id="meta-test",
        studio_session=StudioSession(),
    )
    managed.studio_session.workspace_dir = str(tmp_path)
    managed.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(tmp_path)},
    ]

    manager.align_meta_session_workspace(managed)

    expected = str(canonical.resolve())
    assert managed.studio_session.workspace_dir == expected
    assert managed.taskspaces[0]["path"] == expected
