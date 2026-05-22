#!/usr/bin/env python3
"""Project state store: path resolution, atomic writes, file lock.

Author: Damon Li
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from agenticx.project_state.schema import (
    FeatureListV1,
    StatusV1,
    default_feature_list,
    default_status,
)

DEFAULT_REPO_RELATIVE = ".agx/project"
GLOBAL_FALLBACK_ROOT = Path.home() / ".agenticx" / "projects"

FEATURE_LIST_NAME = "feature_list.json"
STATUS_NAME = "status.json"
PROGRESS_NAME = "progress.md"
INIT_SCRIPT_NAME = "init.sh"
VERIFY_YAML_NAME = "verify.yaml"
ARCHIVE_DIR_NAME = "archive"
LOCK_NAME = ".lock"


class ProjectStateError(Exception):
    """Raised on schema, transition, or path violations."""


def _slug(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._-")
    return cleaned or "project"


def _project_id_from_path(repo_root: Path) -> str:
    """Derive a stable project id from the absolute repo path."""
    digest = hashlib.sha1(str(repo_root.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{_slug(repo_root.name)}-{digest}"


def locate_project_root(
    workspace_root: Path,
    *,
    use_fallback: bool = True,
    create: bool = False,
) -> Path:
    """Resolve the on-disk root for the project state directory.

    Priority:
    1. ``<workspace_root>/.agx/project/`` if it exists or ``create`` is True.
    2. ``~/.agenticx/projects/<project_id>/`` if ``use_fallback`` is True.
    """
    workspace_root = Path(workspace_root).expanduser().resolve()
    if not workspace_root.is_dir():
        raise ProjectStateError(f"workspace_root is not a directory: {workspace_root}")
    repo_dir = workspace_root / DEFAULT_REPO_RELATIVE
    if repo_dir.is_dir() or create:
        if create:
            repo_dir.mkdir(parents=True, exist_ok=True)
        return repo_dir.resolve()
    if not use_fallback:
        raise ProjectStateError(f"project state not initialized at {repo_dir}")
    pid = _project_id_from_path(workspace_root)
    fallback = (GLOBAL_FALLBACK_ROOT / pid).resolve()
    if create:
        fallback.mkdir(parents=True, exist_ok=True)
    if not fallback.is_dir():
        raise ProjectStateError(
            f"project state not found in repo or global root for {workspace_root}"
        )
    return fallback


@contextlib.contextmanager
def _file_lock(lock_path: Path, timeout_sec: float = 30.0) -> Iterator[None]:
    """Cross-platform exclusive file lock.

    Uses fcntl.flock on POSIX. On Windows falls back to atomic create-or-busy
    polling on a sentinel file. Best-effort on Windows; single-process callers
    are still serialized through the same Path.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        deadline = time.monotonic() + max(0.1, timeout_sec)
        sentinel = lock_path.with_suffix(lock_path.suffix + ".busy")
        while True:
            try:
                fd = os.open(str(sentinel), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                break
            except FileExistsError:
                if time.monotonic() > deadline:
                    raise ProjectStateError(f"timed out acquiring project lock: {lock_path}")
                time.sleep(0.05)
        try:
            yield
        finally:
            try:
                os.close(fd)
            finally:
                with contextlib.suppress(OSError):
                    sentinel.unlink()
        return

    import fcntl  # POSIX only

    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
    deadline = time.monotonic() + max(0.1, timeout_sec)
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise ProjectStateError(f"timed out acquiring project lock: {lock_path}")
                time.sleep(0.05)
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _atomic_write_text(target: Path, payload: str) -> None:
    """Write ``payload`` to ``target`` atomically via temp-file + os.replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=target.name + ".", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fp:
            fp.write(payload)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp_path, target)
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(tmp_path)
        raise


def _atomic_write_json(target: Path, data: Dict[str, Any]) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    _atomic_write_text(target, payload)


class ProjectStore:
    """Read/write the project state directory with locks and atomic writes."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).expanduser().resolve()
        if not self.root.is_dir():
            raise ProjectStateError(f"project state root not found: {self.root}")

    @classmethod
    def open(cls, workspace_root: Path, *, create: bool = False) -> "ProjectStore":
        root = locate_project_root(workspace_root, create=create)
        return cls(root)

    @property
    def feature_list_path(self) -> Path:
        return self.root / FEATURE_LIST_NAME

    @property
    def status_path(self) -> Path:
        return self.root / STATUS_NAME

    @property
    def progress_path(self) -> Path:
        return self.root / PROGRESS_NAME

    @property
    def init_script_path(self) -> Path:
        return self.root / INIT_SCRIPT_NAME

    @property
    def verify_yaml_path(self) -> Path:
        return self.root / VERIFY_YAML_NAME

    @property
    def archive_dir(self) -> Path:
        return self.root / ARCHIVE_DIR_NAME

    @property
    def lock_path(self) -> Path:
        return self.root / LOCK_NAME

    def is_initialized(self) -> bool:
        return self.status_path.is_file() and self.feature_list_path.is_file()

    def lock(self, timeout_sec: float = 30.0):
        return _file_lock(self.lock_path, timeout_sec=timeout_sec)

    def load_feature_list(self) -> FeatureListV1:
        if not self.feature_list_path.is_file():
            return default_feature_list()
        try:
            raw = json.loads(self.feature_list_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ProjectStateError(
                f"feature_list.json corrupt: {exc.msg} at line {exc.lineno}"
            ) from exc
        try:
            return FeatureListV1.from_dict(raw)
        except ValueError as exc:
            raise ProjectStateError(f"feature_list.json invalid: {exc}") from exc

    def save_feature_list(self, payload: FeatureListV1) -> None:
        _atomic_write_json(self.feature_list_path, payload.to_dict())

    def load_status(self) -> StatusV1:
        if not self.status_path.is_file():
            return default_status()
        try:
            raw = json.loads(self.status_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ProjectStateError(
                f"status.json corrupt: {exc.msg} at line {exc.lineno}"
            ) from exc
        try:
            return StatusV1.from_dict(raw)
        except ValueError as exc:
            raise ProjectStateError(f"status.json invalid: {exc}") from exc

    def save_status(self, status: StatusV1) -> None:
        status.updated_at = time.time()
        _atomic_write_json(self.status_path, status.to_dict())

    def append_progress(self, line: str) -> None:
        """Append one line to progress.md (append-only timeline)."""
        from agenticx.project_state.progress import format_progress_line

        formatted = format_progress_line(line)
        self.progress_path.parent.mkdir(parents=True, exist_ok=True)
        with self.progress_path.open("a", encoding="utf-8") as fp:
            fp.write(formatted)
            if not formatted.endswith("\n"):
                fp.write("\n")

    def read_progress_tail(self, max_lines: int = 50) -> list[str]:
        if not self.progress_path.is_file():
            return []
        try:
            text = self.progress_path.read_text(encoding="utf-8")
        except OSError:
            return []
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if max_lines <= 0:
            return lines
        return lines[-max_lines:]

    def write_archive(self, feature_id: str, snapshot: Dict[str, Any]) -> Path:
        """Persist an immutable snapshot for a committed feature."""
        from agenticx.project_state.schema import _ALLOWED_TRANSITIONS  # type: ignore  # noqa: F401

        slug = _slug(feature_id)
        if not slug:
            raise ProjectStateError(f"feature_id sanitizes to empty: {feature_id!r}")
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        target = self.archive_dir / f"feature_{slug}.json"
        if target.exists():
            raise ProjectStateError(f"archive already exists for feature {feature_id}")
        _atomic_write_json(target, snapshot)
        return target

    def archive_log(self, feature_id: str, suffix: str, payload: str) -> Path:
        """Persist a verify/run log under archive/."""
        slug = _slug(feature_id)
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        target = self.archive_dir / f"verify_{slug}_{ts}.{suffix.lstrip('.')}"
        _atomic_write_text(target, payload)
        return target

    def safe_relative(self, candidate: Path) -> Path:
        """Resolve ``candidate`` and require it to stay under ``root``."""
        resolved = Path(candidate).expanduser().resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ProjectStateError(
                f"path escapes project root: {resolved} not under {self.root}"
            ) from exc
        return resolved

    def project_id(self) -> str:
        status = self.load_status()
        if status.project_id:
            return status.project_id
        return _project_id_from_path(self.root.parent.parent if self.root.name == "project" else self.root)
