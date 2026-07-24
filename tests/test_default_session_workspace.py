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
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    managed = ManagedSession(
        session_id="meta-test",
        studio_session=StudioSession(),
    )
    managed.studio_session.workspace_dir = str(tmp_path)
    managed.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(tmp_path)},
    ]

    manager.align_meta_session_workspace(managed)

    expected = str((tmp_path / "taskspaces" / "meta-test" / "default").resolve())
    assert managed.studio_session.workspace_dir == expected
    assert managed.taskspaces[0]["path"] == expected
    assert Path(expected).is_dir()


def test_apply_session_workspace_dir_meta_uses_session_taskspace(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    managed = ManagedSession(
        session_id="sid-meta",
        studio_session=StudioSession(),
    )
    manager.apply_session_workspace_dir(managed)
    expected = str((tmp_path / "taskspaces" / "sid-meta" / "default").resolve())
    assert managed.studio_session.workspace_dir == expected
    manager._ensure_default_taskspace(managed)
    assert any(
        t.get("id") == "default" and t.get("path") == expected
        for t in managed.taskspaces
    )


def test_align_meta_skips_avatar_sessions(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    avatar_ws = tmp_path / "avatar-ws"
    avatar_ws.mkdir()
    managed = ManagedSession(
        session_id="avatar-sid",
        studio_session=StudioSession(),
        avatar_id="coder",
    )
    managed.studio_session.workspace_dir = str(avatar_ws)
    managed.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(avatar_ws)},
    ]
    manager.align_meta_session_workspace(managed)
    assert managed.studio_session.workspace_dir == str(avatar_ws)
    assert managed.taskspaces[0]["path"] == str(avatar_ws)
