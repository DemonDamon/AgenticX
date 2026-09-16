#!/usr/bin/env python3
"""Capture and restore branch-safe Git working trees.

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.isolate_run import (
    create_isolate_from_tree,
    isolate_base_dir,
    load_isolate_state,
)
from agenticx.runtime.path_policy import path_rule_decision
from agenticx.runtime.replay_ledger.contracts import WorkspaceSnapshotRef
from agenticx.studio.storage.factory import _default_sessions_root

DEFAULT_MAX_CHANGED_FILE_BYTES = 20 * 1024 * 1024
_SENSITIVE_NAMES = (
    ".env",
    ".env.*",
    "credentials*.json",
    "*secret*",
    "*.pem",
    "*.key",
)


def _git(
    cwd: Path,
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )


def _under(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _safe_ref_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(value or "")) or "_"


def _snapshot_repo_registry(
    sessions_root: Path,
    session_id: str,
) -> Path:
    return (
        sessions_root / _safe_ref_part(session_id) / "runs" / ".snapshot-repositories"
    )


def _register_snapshot_repo(
    sessions_root: Path,
    session_id: str,
    repo_root: Path,
) -> None:
    registry = _snapshot_repo_registry(sessions_root, session_id)
    registry.mkdir(parents=True, exist_ok=True)
    encoded = str(repo_root.resolve(strict=True)).encode("utf-8")
    marker = registry / f"{hashlib.sha256(encoded).hexdigest()}.path"
    temp = marker.with_name(f".{marker.name}.{os.getpid()}.tmp")
    temp.write_text(encoded.decode("utf-8"), encoding="utf-8")
    os.replace(temp, marker)


def _changed_paths(worktree: Path) -> list[str]:
    _git(worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    tracked = _git(worktree, "diff", "--name-only", "-z", "HEAD").stdout.split("\0")
    staged = _git(
        worktree, "diff", "--cached", "--name-only", "-z", "HEAD"
    ).stdout.split("\0")
    untracked = _git(
        worktree, "ls-files", "--others", "--exclude-standard", "-z"
    ).stdout.split("\0")
    return sorted({path for path in tracked + staged + untracked if path})


def _dirty_submodule(worktree: Path) -> bool:
    rows = _git(worktree, "ls-files", "-s").stdout.splitlines()
    submodules = [
        row.split("\t", 1)[1]
        for row in rows
        if row.startswith("160000 ") and "\t" in row
    ]
    for relative in submodules:
        path = worktree / relative
        if not path.exists():
            return True
        if _git(path, "status", "--porcelain").stdout.strip():
            return True
    return False


def _path_is_denied(path: Path, raw_rules: Any) -> bool:
    try:
        decision, _ = path_rule_decision(path, raw_rules)
        return decision is False
    except Exception:
        return False


def _unbranchable(
    reason: str,
    *,
    repo_root: Path | None = None,
) -> WorkspaceSnapshotRef:
    return WorkspaceSnapshotRef(
        mode="git" if repo_root is not None else "none",
        branchable=False,
        repo_root=str(repo_root) if repo_root is not None else None,
        reason=reason,
    )


def capture_git_workspace_snapshot(
    session: Any,
    *,
    session_id: str,
    run_id: str,
    seq: int,
    sessions_root: Path | None = None,
) -> WorkspaceSnapshotRef:
    """Capture tracked and non-ignored untracked files using a temporary index."""
    state = load_isolate_state(session)
    if state is None:
        return _unbranchable("not_git_isolate")
    try:
        repo_root = Path(state["repo_root"]).expanduser().resolve(strict=True)
        worktree = Path(state["worktree"]).expanduser().resolve(strict=True)
        isolate_root = isolate_base_dir().expanduser().resolve(strict=True)
    except (KeyError, OSError):
        return _unbranchable("invalid_isolate_state")
    if not _under(worktree, isolate_root):
        return _unbranchable("worktree_outside_isolate_root", repo_root=repo_root)
    try:
        if _git(worktree, "rev-parse", "--show-toplevel").stdout.strip() != str(
            worktree
        ):
            return _unbranchable("multiple_git_roots", repo_root=repo_root)
        changed = _changed_paths(worktree)
        if _dirty_submodule(worktree):
            return _unbranchable("dirty_submodule", repo_root=repo_root)
        raw_rules = getattr(session, "path_rules", None)
        if raw_rules is None:
            raw_rules = ConfigManager.get_value("permissions.path_rules") or []
        max_bytes = int(
            os.environ.get(
                "AGX_REPLAY_MAX_CHANGED_FILE_BYTES",
                str(DEFAULT_MAX_CHANGED_FILE_BYTES),
            )
        )
        for relative in changed:
            path = (worktree / relative).resolve(strict=False)
            current = path if path.is_dir() else path.parent
            while current != worktree and _under(current, worktree):
                if (current / ".git").exists():
                    return _unbranchable("multiple_git_roots", repo_root=repo_root)
                current = current.parent
            basename = path.name.lower()
            if _path_is_denied(path, raw_rules) or any(
                fnmatch.fnmatch(basename, pattern) for pattern in _SENSITIVE_NAMES
            ):
                return _unbranchable("sensitive_path_changed", repo_root=repo_root)
            if path.is_file() and path.stat().st_size > max_bytes:
                return _unbranchable("large_file_changed", repo_root=repo_root)
        base_sha = _git(worktree, "rev-parse", "HEAD").stdout.strip()
        index_fd, index_name = tempfile.mkstemp(prefix="agx-replay-index-")
        os.close(index_fd)
        Path(index_name).unlink(missing_ok=True)
        try:
            env = dict(os.environ)
            env["GIT_INDEX_FILE"] = index_name
            _git(worktree, "read-tree", base_sha, env=env)
            _git(worktree, "add", "-A", "--", ":/", env=env)
            tree_oid = _git(worktree, "write-tree", env=env).stdout.strip()
        finally:
            Path(index_name).unlink(missing_ok=True)
        ref_name = (
            "refs/agenticx/replay/"
            f"{_safe_ref_part(session_id)}/{_safe_ref_part(run_id)}/"
            f"{tree_oid}"
        )
        _git(repo_root, "update-ref", ref_name, tree_oid)
        if sessions_root is not None:
            try:
                _register_snapshot_repo(sessions_root, session_id, repo_root)
            except Exception:
                _git(repo_root, "update-ref", "-d", ref_name)
                raise
        return WorkspaceSnapshotRef(
            mode="git",
            branchable=True,
            tree_oid=tree_oid,
            base_sha=base_sha,
            repo_root=str(repo_root),
            ref_name=ref_name,
        )
    except (OSError, ValueError, subprocess.CalledProcessError):
        return _unbranchable("workspace_snapshot_failed", repo_root=repo_root)


def restore_git_workspace_snapshot(
    snapshot: WorkspaceSnapshotRef,
    *,
    target_session_id: str,
) -> dict[str, str]:
    """Restore a Git tree as dirty state in a new isolate worktree."""
    if (
        not snapshot.branchable
        or snapshot.mode != "git"
        or not snapshot.repo_root
        or not snapshot.base_sha
        or not snapshot.tree_oid
    ):
        raise ValueError(snapshot.reason or "workspace_not_branchable")
    repo_root = Path(snapshot.repo_root).expanduser().resolve(strict=True)
    return create_isolate_from_tree(
        repo_root=repo_root,
        base_sha=snapshot.base_sha,
        tree_oid=snapshot.tree_oid,
        target_session_id=target_session_id,
    )


def delete_snapshot_refs(
    session_id: str,
    *,
    repo_root: Path | None = None,
    sessions_root: Path | None = None,
) -> None:
    """Delete only private snapshot refs owned by one session."""
    roots: set[Path] = set()
    if repo_root is not None:
        roots.add(repo_root.expanduser().resolve(strict=True))
    root = (
        Path(sessions_root) if sessions_root is not None else _default_sessions_root()
    )
    registry = _snapshot_repo_registry(root, session_id)
    if registry.exists():
        for marker in registry.glob("*.path"):
            value = marker.read_text(encoding="utf-8").strip()
            if value:
                roots.add(Path(value).expanduser().resolve(strict=True))
    prefix = f"refs/agenticx/replay/{_safe_ref_part(session_id)}/"
    for resolved in roots:
        refs = _git(
            resolved, "for-each-ref", "--format=%(refname)", prefix
        ).stdout.splitlines()
        for ref_name in refs:
            if ref_name.startswith(prefix):
                _git(resolved, "update-ref", "-d", ref_name)
    if registry.exists():
        shutil.rmtree(registry)
