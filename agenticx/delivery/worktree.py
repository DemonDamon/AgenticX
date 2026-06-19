#!/usr/bin/env python3
"""Git worktree helpers for isolated delivery sandboxes.

Author: Damon Li
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("agenticx.delivery.worktree")


class WorktreeError(RuntimeError):
    """Raised when worktree creation or validation fails."""


def resolve_repo_root(configured: str = "") -> Path:
    if str(configured or "").strip():
        root = Path(configured).expanduser().resolve()
        if (root / ".git").exists() or _git_toplevel(root):
            return _git_toplevel(root) or root
    cwd = Path.cwd()
    top = _git_toplevel(cwd)
    if top is not None:
        return top
    raise WorktreeError("Cannot locate git repository root; set delivery.repo_root in config.yaml")


def _git_toplevel(start: Path) -> Path | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
        out = proc.stdout.strip()
        return Path(out) if out else None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def is_dirty(repo_root: Path) -> bool:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), "status", "--porcelain"],
            check=True,
            capture_output=True,
            text=True,
        )
        return bool(proc.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise WorktreeError(f"git status failed: {exc}") from exc


def create_worktree(
    *,
    repo_root: Path,
    branch: str,
    path: Path,
) -> Path:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and any(path.iterdir()):
        logger.info("Reusing existing worktree at %s", path)
        return path
    if is_dirty(repo_root):
        raise WorktreeError(
            "Git working tree is dirty; stash or commit changes before starting a delivery task"
        )
    try:
        subprocess.run(
            ["git", "-C", str(repo_root), "worktree", "add", "-B", branch, str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.stdout or "").strip()
        raise WorktreeError(f"git worktree add failed: {stderr or exc}") from exc
    return path
