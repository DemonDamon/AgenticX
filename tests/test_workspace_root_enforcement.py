#!/usr/bin/env python3
"""Tests for session workspace root allowlist enforcement.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli import agent_tools as at
from agenticx.cli.studio import StudioSession


def test_unmounted_absolute_write_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(tmp_path / "ws"))
    (tmp_path / "ws").mkdir()
    session = StudioSession()
    session.workspace_dir = str(tmp_path / "ws")
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(tmp_path / "ws"), "mount_mode": "link"},
    ]
    outside = tmp_path / "secret.txt"
    outside.write_text("nope", encoding="utf-8")
    with pytest.raises(ValueError, match="escapes workspace"):
        at._resolve_workspace_path(str(outside), session, for_write=True)


def test_broad_workspace_root_does_not_widen_write_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Desktop sets AGX_WORKSPACE_ROOT to $HOME; it must stay a fallback only."""
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "home" / "ws"
    ws.mkdir(parents=True)
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(tmp_path / "home"))
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    sibling = tmp_path / "home" / "Downloads" / "data.json"
    sibling.parent.mkdir(parents=True)
    sibling.write_text("{}", encoding="utf-8")
    _read_roots, write_roots = at._session_workspace_root_sets(session)
    assert (tmp_path / "home").resolve() not in write_roots
    with pytest.raises(ValueError, match="escapes workspace"):
        at._resolve_workspace_path(str(sibling), session, for_write=True)


def test_reference_mount_read_ok_write_denied(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    src = tmp_path / "src"
    src.mkdir()
    target = src / "note.txt"
    target.write_text("hello", encoding="utf-8")
    mounts = {
        "version": 1,
        "mounts": [
            {
                "name": "note.txt",
                "mode": "reference",
                "source_path": str(target.resolve()),
                "linked_at": 1.0,
            }
        ],
    }
    (ws / ".agx-mounts.json").write_text(json.dumps(mounts), encoding="utf-8")
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(ws))
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    read_path = at._resolve_workspace_path(str(target), session, for_write=False)
    assert read_path == target.resolve()
    with pytest.raises(ValueError, match="escapes workspace"):
        at._resolve_workspace_path(str(target), session, for_write=True)


def test_link_mount_read_write_ok(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    src = tmp_path / "repo"
    src.mkdir()
    (src / "a.py").write_text("x=1\n", encoding="utf-8")
    (ws / ".agx-mounts.json").write_text(
        json.dumps(
            {
                "version": 1,
                "mounts": [
                    {
                        "name": "repo",
                        "mode": "link",
                        "source_path": str(src.resolve()),
                        "linked_at": 1.0,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(ws))
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    file_path = src / "a.py"
    assert at._resolve_workspace_path(str(file_path), session, for_write=False) == file_path.resolve()
    assert at._resolve_workspace_path(str(file_path), session, for_write=True) == file_path.resolve()


def test_file_edit_rejects_reference_mount(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: file_edit must use for_write roots (reference is read-only)."""
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    src = tmp_path / "src"
    src.mkdir()
    target = src / "analysis_data.json"
    target.write_text('{"daily":[]}\n', encoding="utf-8")
    (ws / ".agx-mounts.json").write_text(
        json.dumps(
            {
                "version": 1,
                "mounts": [
                    {
                        "name": "analysis_data.json",
                        "mode": "reference",
                        "source_path": str(target.resolve()),
                        "linked_at": 1.0,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(ws))
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    with pytest.raises(ValueError, match="escapes workspace"):
        at._resolve_workspace_path(
            str(target),
            session,
            pick_existing=True,
            for_write=True,
        )


def test_ssh_protected_even_when_mounted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(ws))
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    ssh_key = Path.home() / ".ssh" / "id_rsa"
    with pytest.raises(ValueError, match="protected"):
        at._resolve_workspace_path(str(ssh_key), session, for_write=False)
