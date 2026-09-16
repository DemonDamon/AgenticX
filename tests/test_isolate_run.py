#!/usr/bin/env python3
"""Isolate-run worktree helpers.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.cli import agent_tools as at
from agenticx.runtime.isolate_run import (
    adopt_isolate,
    apply_isolate_roots,
    discard_isolate,
    ensure_isolate,
    remap_path_into_isolate,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True)


def _init_dirty_repo(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init")
    _git(root, "config", "user.email", "isolate@test.local")
    _git(root, "config", "user.name", "Isolate Test")
    (root / "README.md").write_text("main readme\n", encoding="utf-8")
    _git(root, "add", "README.md")
    _git(root, "commit", "-m", "init")
    (root / "dirty-uncommitted.txt").write_text("leave me on main\n", encoding="utf-8")
    return root


def _session(repo: Path, session_id: str = "sess-iso-1") -> SimpleNamespace:
    return SimpleNamespace(
        session_id=session_id,
        workspace_dir=str(repo),
        taskspaces=[{"id": "default", "path": str(repo), "mount_mode": "link"}],
        active_taskspace_id="",
        scratchpad={},
    )


def test_ensure_isolate_allows_dirty_and_omits_uncommitted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    repo = _init_dirty_repo(tmp_path / "repo")
    session = _session(repo)

    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    assert result.get("active") is True
    worktree = Path(result["worktree"])
    assert worktree.is_dir()
    assert (worktree / "README.md").read_text(encoding="utf-8") == "main readme\n"
    assert not (worktree / "dirty-uncommitted.txt").exists()
    assert (repo / "dirty-uncommitted.txt").exists()


def test_remap_absolute_source_path_into_worktree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    repo = _init_dirty_repo(tmp_path / "repo")
    session = _session(repo)
    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    worktree = Path(result["worktree"])

    mapped = remap_path_into_isolate((repo / "README.md").resolve(), session)
    assert mapped == (worktree / "README.md").resolve()
    already = remap_path_into_isolate(worktree / "README.md", session)
    assert already == (worktree / "README.md").resolve()


def test_adopt_copies_only_worktree_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    repo = _init_dirty_repo(tmp_path / "repo")
    session = _session(repo)
    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    worktree = Path(result["worktree"])

    (worktree / "README.md").write_text("isolated readme\n", encoding="utf-8")
    (worktree / "new-from-isolate.txt").write_text("only isolate\n", encoding="utf-8")
    (repo / "main-only.txt").write_text("stay on main\n", encoding="utf-8")

    adopted = adopt_isolate(session)
    assert adopted.get("ok") is True
    assert (repo / "README.md").read_text(encoding="utf-8") == "isolated readme\n"
    assert (repo / "new-from-isolate.txt").read_text(encoding="utf-8") == "only isolate\n"
    assert (repo / "dirty-uncommitted.txt").read_text(encoding="utf-8") == "leave me on main\n"
    assert (repo / "main-only.txt").read_text(encoding="utf-8") == "stay on main\n"
    assert not worktree.exists()


def test_discard_removes_worktree_without_touching_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    repo = _init_dirty_repo(tmp_path / "repo")
    session = _session(repo)
    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    worktree = Path(result["worktree"])
    (worktree / "README.md").write_text("should not land\n", encoding="utf-8")

    discarded = discard_isolate(session)
    assert discarded.get("ok") is True
    assert not worktree.exists()
    assert (repo / "README.md").read_text(encoding="utf-8") == "main readme\n"
    assert (repo / "dirty-uncommitted.txt").exists()


def test_resolve_workspace_path_writes_into_worktree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    repo = _init_dirty_repo(tmp_path / "repo")
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(repo))
    session = _session(repo)
    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    worktree = Path(result["worktree"])

    resolved = at._resolve_workspace_path("README.md", session, for_write=True)
    assert resolved == (worktree / "README.md").resolve()

    abs_resolved = at._resolve_workspace_path(str(repo / "README.md"), session, for_write=True)
    assert abs_resolved == (worktree / "README.md").resolve()

    reads, writes = at._session_workspace_root_sets(session)
    write_keys = {str(p.resolve()) for p in writes}
    assert str(worktree.resolve()) in write_keys
    assert str(repo.resolve()) not in write_keys
    assert apply_isolate_roots(reads, writes, session)[1]


def test_not_git_returns_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path / "isolates"))
    folder = tmp_path / "plain"
    folder.mkdir()
    session = _session(folder)
    result = ensure_isolate(session, isolate_run=True, is_automation=False)
    assert result.get("active") is False
    assert result.get("error") == "not_git"
    assert session.scratchpad.get("isolate_json") in (None, "", "{}")
