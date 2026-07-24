#!/usr/bin/env python3
"""Tests for taskspace path resolve with outbound symlinks.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.studio.session_manager import ManagedSession, SessionManager


def _manager_with_default(tmp_path: Path, sid: str = "ts-symlink") -> tuple[SessionManager, ManagedSession, Path]:
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
    return manager, managed, default.resolve()


def test_resolve_allows_file_symlink_outside_root(tmp_path: Path) -> None:
    manager, _managed, default = _manager_with_default(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("hello-symlink\n", encoding="utf-8")
    link = default / "note.txt"
    link.symlink_to(outside)

    target = manager._resolve_inside_root(default, "note.txt", expect_dir=False)
    assert target.is_symlink()
    assert target.read_text(encoding="utf-8") == "hello-symlink\n"


def test_resolve_rejects_parent_escape(tmp_path: Path) -> None:
    manager, _managed, default = _manager_with_default(tmp_path, sid="ts-escape")
    with pytest.raises(ValueError, match="escapes"):
        manager._resolve_inside_root(default, "../secret", expect_dir=False)


def test_list_and_read_through_dir_symlink(tmp_path: Path) -> None:
    manager, _managed, default = _manager_with_default(tmp_path, sid="ts-dirlink")
    real_dir = tmp_path / "real-project"
    real_dir.mkdir()
    (real_dir / "main.py").write_text("print(1)\n", encoding="utf-8")
    link = default / "proj"
    link.symlink_to(real_dir, target_is_directory=True)

    rows = manager.list_taskspace_files("ts-dirlink", "default", ".")
    names = {r["name"] for r in rows}
    assert "proj" in names
    proj = next(r for r in rows if r["name"] == "proj")
    assert proj["type"] == "dir"
    assert proj.get("is_symlink") is True

    nested = manager.list_taskspace_files("ts-dirlink", "default", "proj")
    assert any(r["name"] == "main.py" and r["path"] == "proj/main.py" for r in nested)

    payload = manager.read_taskspace_file("ts-dirlink", "default", "proj/main.py")
    assert payload["path"] == "proj/main.py"
    assert "print(1)" in payload.get("content", "")
