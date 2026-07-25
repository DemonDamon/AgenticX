#!/usr/bin/env python3
"""Tests for taskspace listing symlink guard and truncation.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.studio.session_manager import ManagedSession, SessionManager


def _manager_with_default(tmp_path: Path, sid: str = "ts-list-guard") -> tuple[SessionManager, Path]:
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    default = tmp_path / "taskspaces" / sid / "default"
    default.mkdir(parents=True)
    managed = ManagedSession(session_id=sid, studio_session=StudioSession())
    managed.studio_session.workspace_dir = str(default)
    managed.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(default.resolve())},
    ]
    manager._sessions[sid] = managed
    return manager, default.resolve()


def test_list_marks_symlink_and_dangling(tmp_path: Path) -> None:
    manager, default = _manager_with_default(tmp_path)
    target = tmp_path / "target.txt"
    target.write_text("hello\n", encoding="utf-8")
    link = default / "link.txt"
    link.symlink_to(target)

    listing = manager.list_taskspace_files("ts-list-guard", "default", ".")
    rows = listing["files"]
    row = next(r for r in rows if r["name"] == "link.txt")
    assert row["is_symlink"] is True
    assert row.get("dangling") is False

    target.unlink()
    listing2 = manager.list_taskspace_files("ts-list-guard", "default", ".")
    row2 = next(r for r in listing2["files"] if r["name"] == "link.txt")
    assert row2["is_symlink"] is True
    assert row2.get("dangling") is True
    assert listing2["truncated"] is False


def test_list_truncates_at_max_entries(tmp_path: Path) -> None:
    manager, default = _manager_with_default(tmp_path, sid="ts-truncate")
    for i in range(3000):
        (default / f"f{i:04d}.txt").write_text("x", encoding="utf-8")

    listing = manager.list_taskspace_files("ts-truncate", "default", ".", max_entries=2000)
    assert listing["truncated"] is True
    assert listing["total_seen"] == 3000
    assert len(listing["files"]) == 2000


def test_mount_mode_defaults_to_link(tmp_path: Path) -> None:
    manager, _default = _manager_with_default(tmp_path, sid="ts-mount-default")
    rows = manager.list_taskspaces("ts-mount-default")
    assert rows[0].get("mount_mode") == "link"


def test_sanitize_preserves_mount_mode(tmp_path: Path) -> None:
    manager, default = _manager_with_default(tmp_path, sid="ts-mount-sanitize")
    sanitized = manager._sanitize_taskspaces(
        "ts-mount-sanitize",
        [
            {
                "id": "default",
                "label": "默认工作区",
                "path": str(default),
                "mount_mode": "copy",
                "source_path": "/tmp/src",
                "linked_at": 123.0,
            }
        ],
    )
    assert sanitized[0]["mount_mode"] == "copy"
    assert sanitized[0]["source_path"] == "/tmp/src"

    legacy = manager._sanitize_taskspaces(
        "ts-mount-sanitize",
        [{"id": "default", "label": "默认工作区", "path": str(default)}],
    )
    assert legacy[0].get("mount_mode") == "link"
