#!/usr/bin/env python3
"""Tests for immutable Git workspace snapshots used by replay branches.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import isolate_run
from agenticx.runtime.isolate_run import create_isolate_from_tree, save_isolate_state
from agenticx.runtime.replay_ledger.workspace_snapshot import (
    capture_git_workspace_snapshot,
    delete_snapshot_refs,
    restore_git_workspace_snapshot,
)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    (repo / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
    (repo / "tracked.txt").write_text("base\n", encoding="utf-8")
    (repo / "deleted.txt").write_text("delete\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    return repo


def _session(repo: Path, isolate_root: Path) -> StudioSession:
    session = StudioSession()
    session.session_id = "source-session"
    save_isolate_state(
        session,
        {
            "run_id": "isolate-a",
            "repo_root": str(repo),
            "worktree": str(repo),
            "branch": "source",
            "start_sha": _git(repo, "rev-parse", "HEAD"),
        },
    )
    return session


def test_snapshot_captures_dirty_tree_without_touching_real_index(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = _repo(tmp_path)
    isolate_root = tmp_path
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(isolate_root))
    session = _session(repo, isolate_root)
    (repo / "tracked.txt").write_text("changed\n", encoding="utf-8")
    (repo / "deleted.txt").unlink()
    (repo / "new.txt").write_text("new\n", encoding="utf-8")
    (repo / "ignored.txt").write_text("ignored\n", encoding="utf-8")
    index_path = Path(_git(repo, "rev-parse", "--git-path", "index"))
    if not index_path.is_absolute():
        index_path = repo / index_path
    before = hashlib.sha256(index_path.read_bytes()).hexdigest()

    snapshot = capture_git_workspace_snapshot(
        session,
        session_id="source-session",
        run_id="run-a",
        seq=100,
    )

    assert snapshot.branchable is True
    assert snapshot.tree_oid
    assert hashlib.sha256(index_path.read_bytes()).hexdigest() == before
    tree_names = _git(
        repo, "ls-tree", "-r", "--name-only", snapshot.tree_oid
    ).splitlines()
    assert "tracked.txt" in tree_names
    assert "new.txt" in tree_names
    assert "deleted.txt" not in tree_names
    assert "ignored.txt" not in tree_names
    reused = capture_git_workspace_snapshot(
        session,
        session_id="source-session",
        run_id="run-a",
        seq=101,
    )
    assert reused.ref_name == snapshot.ref_name


def test_snapshot_rejects_sensitive_and_large_changes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = _repo(tmp_path)
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path))
    session = _session(repo, tmp_path)
    (repo / ".env.local").write_text("SECRET=x", encoding="utf-8")
    sensitive = capture_git_workspace_snapshot(
        session, session_id="s1", run_id="r1", seq=1
    )
    assert sensitive.reason == "sensitive_path_changed"

    (repo / ".env.local").unlink()
    (repo / "large.bin").write_bytes(b"x" * 101)
    monkeypatch.setenv("AGX_REPLAY_MAX_CHANGED_FILE_BYTES", "100")
    large = capture_git_workspace_snapshot(session, session_id="s1", run_id="r1", seq=2)
    assert large.reason == "large_file_changed"


def test_snapshot_rejects_nested_writable_git_root(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = _repo(tmp_path)
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path))
    session = _session(repo, tmp_path)
    nested = repo / "nested"
    nested.mkdir()
    _git(nested, "init")
    (nested / "file.txt").write_text("nested\n", encoding="utf-8")

    snapshot = capture_git_workspace_snapshot(
        session, session_id="s1", run_id="r1", seq=1
    )

    assert snapshot.reason == "multiple_git_roots"


def test_snapshot_rejects_non_git_session_and_dirty_submodule(
    tmp_path: Path,
    monkeypatch,
) -> None:
    assert (
        capture_git_workspace_snapshot(
            StudioSession(),
            session_id="s1",
            run_id="r1",
            seq=1,
        ).reason
        == "not_git_isolate"
    )

    repo = _repo(tmp_path)
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path))
    session = _session(repo, tmp_path)
    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.workspace_snapshot._dirty_submodule",
        lambda _worktree: True,
    )
    snapshot = capture_git_workspace_snapshot(
        session,
        session_id="s1",
        run_id="r1",
        seq=2,
    )
    assert snapshot.reason == "dirty_submodule"


def test_restore_has_snapshot_bytes_no_commit_and_preserves_source(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = _repo(tmp_path)
    isolate_root = tmp_path / "isolates"
    isolate_root.mkdir()
    source_worktree = isolate_root / "source"
    _git(repo, "worktree", "add", "-b", "source-branch", str(source_worktree))
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(isolate_root))
    session = _session(repo, isolate_root)
    state = {
        "run_id": "source-run",
        "repo_root": str(repo),
        "worktree": str(source_worktree),
        "branch": "source-branch",
        "start_sha": _git(source_worktree, "rev-parse", "HEAD"),
    }
    save_isolate_state(session, state)
    (source_worktree / "tracked.txt").write_text("snapshot\n", encoding="utf-8")
    source_status = _git(source_worktree, "status", "--porcelain")
    source_log = _git(source_worktree, "rev-list", "--count", "HEAD")
    snapshot = capture_git_workspace_snapshot(
        session, session_id="source-session", run_id="run-a", seq=3
    )

    restored = restore_git_workspace_snapshot(
        snapshot,
        target_session_id="target-session",
    )
    target = Path(restored["worktree"])
    assert (target / "tracked.txt").read_text(encoding="utf-8") == "snapshot\n"
    assert _git(target, "rev-list", "--count", "HEAD") == source_log
    assert _git(source_worktree, "status", "--porcelain") == source_status
    assert _git(target, "status", "--porcelain")

    delete_snapshot_refs("source-session", repo_root=repo)
    assert not _git(
        repo,
        "for-each-ref",
        "--format=%(refname)",
        "refs/agenticx/replay/source-session",
    )


def test_snapshot_registry_allows_session_scoped_ref_cleanup(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo = _repo(tmp_path)
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(tmp_path))
    session = _session(repo, tmp_path)
    snapshot = capture_git_workspace_snapshot(
        session,
        session_id="source-session",
        run_id="run-a",
        seq=1,
        sessions_root=tmp_path / "sessions",
    )
    _git(
        repo, "update-ref", "refs/agenticx/replay/other-session/keep", snapshot.tree_oid
    )

    delete_snapshot_refs("source-session", sessions_root=tmp_path / "sessions")

    assert not _git(
        repo,
        "for-each-ref",
        "--format=%(refname)",
        "refs/agenticx/replay/source-session",
    )
    assert (
        _git(
            repo,
            "for-each-ref",
            "--format=%(refname)",
            "refs/agenticx/replay/other-session",
        )
        == "refs/agenticx/replay/other-session/keep"
    )


@pytest.mark.parametrize(
    "failed_stage",
    ["worktree_add", "read_tree", "reset_mixed", "verify_tree"],
)
def test_restore_failure_cleans_branch_and_worktree_without_touching_source(
    tmp_path: Path,
    monkeypatch,
    failed_stage: str,
) -> None:
    repo = _repo(tmp_path)
    isolate_root = tmp_path / "isolates"
    isolate_root.mkdir()
    monkeypatch.setenv("AGX_ISOLATE_ROOT", str(isolate_root))
    source_status = _git(repo, "status", "--porcelain")
    source_head = _git(repo, "rev-parse", "HEAD")
    tree_oid = _git(repo, "rev-parse", "HEAD^{tree}")
    original_git = isolate_run._git

    def failing_git(cwd: Path, *args: str, env=None):
        stage = None
        if args[:2] == ("worktree", "add"):
            stage = "worktree_add"
        elif args[:2] == ("read-tree", "--reset"):
            stage = "read_tree"
        elif args[:2] == ("reset", "--mixed"):
            stage = "reset_mixed"
        elif args == ("write-tree",):
            stage = "verify_tree"
        if stage == failed_stage:
            raise subprocess.CalledProcessError(1, ["git", *args])
        return original_git(cwd, *args, env=env)

    monkeypatch.setattr(isolate_run, "_git", failing_git)
    with pytest.raises(RuntimeError, match=f"workspace_restore_failed:{failed_stage}"):
        create_isolate_from_tree(
            repo_root=repo,
            base_sha=source_head,
            tree_oid=tree_oid,
            target_session_id="target-session",
        )

    assert _git(repo, "status", "--porcelain") == source_status
    assert _git(repo, "rev-parse", "HEAD") == source_head
    assert not _git(repo, "branch", "--list", "agx-branch/*")
    assert not any(isolate_root.rglob(".git"))
