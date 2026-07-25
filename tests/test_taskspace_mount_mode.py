#!/usr/bin/env python3
"""Tests for taskspace mount_mode metadata.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.studio.session_manager import ManagedSession, SessionManager


def test_list_taskspaces_echoes_mount_modes(tmp_path: Path) -> None:
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    sid = "mount-modes"
    default = tmp_path / "taskspaces" / sid / "default"
    default.mkdir(parents=True)
    managed = ManagedSession(session_id=sid, studio_session=StudioSession())
    managed.studio_session.workspace_dir = str(default)
    managed.taskspaces = [
        {
            "id": "default",
            "label": "默认工作区",
            "path": str(default.resolve()),
            "mount_mode": "link",
        },
        {
            "id": "ts-ref",
            "label": "ref",
            "path": str((tmp_path / "ref").resolve()),
            "mount_mode": "reference",
            "source_path": "/tmp/a",
        },
        {
            "id": "ts-copy",
            "label": "copy",
            "path": str((tmp_path / "copy").resolve()),
            "mount_mode": "copy",
            "source_path": "/tmp/b",
        },
    ]
    (tmp_path / "ref").mkdir()
    (tmp_path / "copy").mkdir()
    manager._sessions[sid] = managed

    rows = {r["id"]: r for r in manager.list_taskspaces(sid)}
    assert rows["default"]["mount_mode"] == "link"
    assert rows["ts-ref"]["mount_mode"] == "reference"
    assert rows["ts-copy"]["mount_mode"] == "copy"


def test_legacy_metadata_defaults_mount_mode_link(tmp_path: Path) -> None:
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    sid = "legacy-mount"
    default = tmp_path / "taskspaces" / sid / "default"
    default.mkdir(parents=True)
    managed = ManagedSession(session_id=sid, studio_session=StudioSession())
    managed.studio_session.workspace_dir = str(default)
    managed.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(default.resolve())},
    ]
    manager._sessions[sid] = managed
    rows = manager.list_taskspaces(sid)
    assert rows[0]["mount_mode"] == "link"
