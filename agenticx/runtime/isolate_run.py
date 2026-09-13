#!/usr/bin/env python3
"""Single-run git worktree isolation (Multitask).

Does not import agenticx.delivery.worktree — that helper rejects dirty trees.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.runtime.isolate_run")

_ISOLATE_KEY = "isolate_json"
_ISOLATE_BLOCK = (
    "## Isolated copy\n"
    "You are editing an isolated git worktree, not the user's main checkout.\n"
    "Prefer relative paths. If you use absolute paths, they will be remapped.\n"
    "Do not try to write the original repository root.\n"
)


def isolate_base_dir() -> Path:
    override = os.environ.get("AGX_ISOLATE_ROOT", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".agenticx" / "isolates"


def find_git_root(start: Path) -> Path | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
        out = (proc.stdout or "").strip()
        return Path(out) if out else None
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None


def load_isolate_state(session: Any) -> dict[str, str] | None:
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return None
    raw = scratch.get(_ISOLATE_KEY)
    data: Any = None
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
    elif isinstance(raw, dict):
        data = raw
    if not isinstance(data, dict):
        return None
    worktree = str(data.get("worktree") or "").strip()
    repo_root = str(data.get("repo_root") or "").strip()
    if not worktree or not repo_root:
        return None
    return {
        "run_id": str(data.get("run_id") or ""),
        "repo_root": repo_root,
        "worktree": worktree,
        "branch": str(data.get("branch") or ""),
        "start_sha": str(data.get("start_sha") or ""),
    }


def save_isolate_state(session: Any, state: dict[str, str] | None) -> None:
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        session.scratchpad = {}
        scratch = session.scratchpad
    if state is None:
        scratch.pop(_ISOLATE_KEY, None)
        return
    scratch[_ISOLATE_KEY] = json.dumps(state, ensure_ascii=False)


def _session_id_of(session: Any) -> str:
    for key in ("session_id", "_session_id"):
        value = str(getattr(session, key, "") or "").strip()
        if value:
            return value
    return "session"


def _safe_slug(value: str, fallback: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip())
    text = text.strip("-")[:32] or fallback
    return text


def _candidate_start_paths(session: Any) -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()

    def _add(raw: str) -> None:
        text = str(raw or "").strip()
        if not text:
            return
        try:
            path = Path(text).expanduser()
        except Exception:
            return
        key = str(path)
        if key in seen:
            return
        seen.add(key)
        out.append(path)

    active_id = str(getattr(session, "active_taskspace_id", "") or "").strip()
    taskspaces = getattr(session, "taskspaces", None)
    if isinstance(taskspaces, list) and active_id:
        for item in taskspaces:
            if isinstance(item, dict) and str(item.get("id", "")).strip() == active_id:
                _add(str(item.get("path", "") or ""))
                break
    if isinstance(taskspaces, list):
        for item in taskspaces:
            if isinstance(item, dict):
                _add(str(item.get("path", "") or ""))
    _add(str(getattr(session, "workspace_dir", "") or ""))
    return out


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


def _git_ok(cwd: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return _git(cwd, *args)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None


def _worktree_exists(path: Path) -> bool:
    try:
        return path.is_dir() and ((path / ".git").exists() or (path / ".git").is_file())
    except OSError:
        return False


def _path_under(candidate: Path, root: Path) -> bool:
    try:
        cand = candidate.expanduser().resolve(strict=False)
        base = root.expanduser().resolve(strict=False)
        cand.relative_to(base)
        return True
    except (ValueError, OSError):
        return False


def remap_path_into_isolate(path: Path, session: Any) -> Path:
    state = load_isolate_state(session)
    if state is None:
        return path
    try:
        resolved = path.expanduser().resolve(strict=False)
        repo = Path(state["repo_root"]).expanduser().resolve(strict=False)
        worktree = Path(state["worktree"]).expanduser().resolve(strict=False)
    except OSError:
        return path
    if _path_under(resolved, worktree):
        return resolved
    if _path_under(resolved, repo):
        rel = resolved.relative_to(repo)
        return (worktree / rel).resolve(strict=False)
    return resolved


def apply_isolate_roots(
    read_roots: list[Path],
    write_roots: list[Path],
    session: Any,
) -> tuple[list[Path], list[Path]]:
    state = load_isolate_state(session)
    if state is None:
        return read_roots, write_roots
    try:
        repo = Path(state["repo_root"]).expanduser().resolve(strict=False)
        worktree = Path(state["worktree"]).expanduser().resolve(strict=False)
    except OSError:
        return read_roots, write_roots
    if not _worktree_exists(worktree):
        return read_roots, write_roots

    def _swap(roots: list[Path]) -> list[Path]:
        out: list[Path] = []
        seen: set[str] = set()
        for root in roots:
            try:
                resolved = root.expanduser().resolve(strict=False)
            except OSError:
                continue
            mapped = resolved
            if resolved == repo or _path_under(resolved, repo):
                if resolved == repo:
                    mapped = worktree
                else:
                    mapped = worktree / resolved.relative_to(repo)
            if (
                mapped == repo
                or _path_under(mapped, repo)
                and not _path_under(mapped, worktree)
            ):
                mapped = worktree
            key = str(mapped)
            if key in seen:
                continue
            seen.add(key)
            out.append(mapped)
        return out

    new_write = _swap(write_roots)
    new_read = _swap(read_roots)
    repo_key = str(repo)
    new_write = [p for p in new_write if str(p) != repo_key]
    if str(worktree) not in {str(p) for p in new_write}:
        new_write.insert(0, worktree)
    if not new_read:
        new_read = list(new_write)
    elif str(worktree) not in {str(p) for p in new_read}:
        new_read.insert(0, worktree)
    return new_read, new_write


def discard_isolate(session: Any) -> dict[str, Any]:
    state = load_isolate_state(session)
    if state is None:
        return {"ok": True, "isolate": None}
    repo = Path(state["repo_root"]).expanduser()
    worktree = Path(state["worktree"]).expanduser()
    branch = state.get("branch") or ""
    try:
        subprocess.run(
            ["git", "-C", str(repo), "worktree", "remove", "--force", str(worktree)],
            check=False,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, OSError) as exc:
        logger.warning("isolate discard worktree remove failed: %s", exc)
    if branch:
        try:
            subprocess.run(
                ["git", "-C", str(repo), "branch", "-D", branch],
                check=False,
                capture_output=True,
                text=True,
            )
        except (FileNotFoundError, OSError):
            pass
    try:
        if worktree.exists():
            shutil.rmtree(worktree, ignore_errors=True)
    except OSError:
        pass
    save_isolate_state(session, None)
    return {"ok": True, "isolate": None}


def _changed_relpaths(worktree: Path, start_sha: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def _extend(proc: subprocess.CompletedProcess[str] | None) -> None:
        if proc is None:
            return
        for line in (proc.stdout or "").splitlines():
            rel = line.strip()
            if not rel or rel in seen:
                continue
            seen.add(rel)
            names.append(rel)

    _extend(_git_ok(worktree, "diff", "--name-only", start_sha))
    _extend(_git_ok(worktree, "ls-files", "--others", "--exclude-standard"))
    return names


def adopt_isolate(session: Any) -> dict[str, Any]:
    state = load_isolate_state(session)
    if state is None:
        return {"ok": False, "error": "no_isolate"}
    worktree = Path(state["worktree"]).expanduser()
    repo = Path(state["repo_root"]).expanduser()
    start_sha = state.get("start_sha") or ""
    if not _worktree_exists(worktree):
        save_isolate_state(session, None)
        return {"ok": False, "error": "worktree_missing"}
    if not start_sha:
        return {"ok": False, "error": "missing_start_sha"}
    for rel in _changed_relpaths(worktree, start_sha):
        src = worktree / rel
        dest = repo / rel
        try:
            if src.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                if src.is_dir():
                    shutil.copytree(src, dest, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, dest)
            elif dest.exists() or dest.is_symlink():
                dest.unlink()
        except OSError as exc:
            logger.warning("isolate adopt failed for %s: %s", rel, exc)
            return {"ok": False, "error": f"adopt_copy_failed:{rel}"}
    discarded = discard_isolate(session)
    if not discarded.get("ok"):
        return discarded
    return {"ok": True, "isolate": None}


def ensure_isolate(
    session: Any, *, isolate_run: bool, is_automation: bool
) -> dict[str, Any]:
    if is_automation:
        existing = load_isolate_state(session)
        if existing is not None:
            discard_isolate(session)
        else:
            save_isolate_state(session, None)
        return {"active": False}

    current = load_isolate_state(session)
    if current is not None:
        worktree = Path(current["worktree"]).expanduser()
        if _worktree_exists(worktree):
            return {"active": True, **current}
        save_isolate_state(session, None)

    if not isolate_run:
        return {"active": False}

    git_root: Path | None = None
    for start in _candidate_start_paths(session):
        git_root = find_git_root(start)
        if git_root is not None:
            break
    if git_root is None:
        return {"active": False, "error": "not_git"}

    run_id = uuid.uuid4().hex
    session_id = _session_id_of(session)
    dest = isolate_base_dir() / session_id / run_id
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)

    branch = f"agx-isolate/{_safe_slug(session_id, 'sess')[:8]}-{run_id[:8]}"
    try:
        _git(git_root, "worktree", "add", "-b", branch, str(dest))
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        logger.warning("isolate worktree add failed: %s", exc)
        shutil.rmtree(dest, ignore_errors=True)
        return {"active": False, "error": "not_git"}

    sha_proc = _git_ok(dest, "rev-parse", "HEAD")
    start_sha = (sha_proc.stdout or "").strip() if sha_proc else ""
    if not start_sha:
        discard_isolate(session)
        try:
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(git_root),
                    "worktree",
                    "remove",
                    "--force",
                    str(dest),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        except (FileNotFoundError, OSError):
            pass
        shutil.rmtree(dest, ignore_errors=True)
        return {"active": False, "error": "not_git"}

    state = {
        "run_id": run_id,
        "repo_root": str(git_root.resolve(strict=False)),
        "worktree": str(dest.resolve(strict=False)),
        "branch": branch,
        "start_sha": start_sha,
    }
    save_isolate_state(session, state)
    return {"active": True, **state}


def create_isolate_from_tree(
    *,
    repo_root: Path,
    base_sha: str,
    tree_oid: str,
    target_session_id: str,
) -> dict[str, str]:
    """Create a new isolate whose dirty working state matches a verified tree."""
    safe_session = _safe_slug(target_session_id, "session")
    run_id = uuid.uuid4().hex
    destination = isolate_base_dir() / safe_session / run_id
    branch = f"agx-branch/{safe_session[:16]}-{run_id[:8]}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = "worktree_add"
    try:
        _git(
            repo_root,
            "worktree",
            "add",
            "-b",
            branch,
            str(destination),
            base_sha,
        )
        stage = "read_tree"
        _git(destination, "read-tree", "--reset", "-u", tree_oid)
        stage = "reset_mixed"
        _git(destination, "reset", "--mixed", base_sha)
        stage = "verify_tree"
        index_fd, index_name = tempfile.mkstemp(prefix="agx-replay-index-")
        os.close(index_fd)
        Path(index_name).unlink(missing_ok=True)
        try:
            env = dict(os.environ)
            env["GIT_INDEX_FILE"] = index_name
            _git(destination, "read-tree", base_sha, env=env)
            _git(destination, "add", "-A", "--", ":/", env=env)
            verified = _git(destination, "write-tree", env=env).stdout.strip()
        finally:
            Path(index_name).unlink(missing_ok=True)
        if verified != tree_oid:
            raise RuntimeError("restored tree verification mismatch")
        return {
            "run_id": run_id,
            "repo_root": str(repo_root.resolve(strict=True)),
            "worktree": str(destination.resolve(strict=True)),
            "branch": branch,
            "start_sha": base_sha,
        }
    except Exception as exc:
        subprocess.run(
            [
                "git",
                "-C",
                str(repo_root),
                "worktree",
                "remove",
                "--force",
                str(destination),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_root), "branch", "-D", branch],
            check=False,
            capture_output=True,
            text=True,
        )
        shutil.rmtree(destination, ignore_errors=True)
        raise RuntimeError(f"workspace_restore_failed:{stage}") from exc


def build_isolate_block(session: Any) -> str:
    if load_isolate_state(session) is None:
        return ""
    return _ISOLATE_BLOCK
