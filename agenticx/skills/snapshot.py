#!/usr/bin/env python3
"""Skill directory snapshots for guard AI-fix rollback.

Snapshots live under ``<skill_dir>/.snapshots/<snapshot_id>/`` with a
``meta.json`` manifest. Only text files under the skill tree are copied.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.skills.versioning import append_changelog

logger = logging.getLogger("agenticx.skills")

SNAPSHOTS_DIR = ".snapshots"
META_FILENAME = "meta.json"
MAX_SNAPSHOTS = 5
MAX_FILE_BYTES = 256 * 1024

TEXT_EXTENSIONS = frozenset(
    {
        ".md",
        ".py",
        ".sh",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".json",
        ".yaml",
        ".yml",
        ".txt",
        ".toml",
        ".ini",
        ".cfg",
        ".xml",
        ".html",
        ".css",
        ".scss",
        ".sql",
        ".rb",
        ".go",
        ".rs",
        ".java",
        ".kt",
        ".swift",
        ".c",
        ".cpp",
        ".h",
        ".hpp",
        ".vue",
        ".svelte",
    }
)

_SNAPSHOT_ID_RE = re.compile(r"^\d{8}_\d{6}(?:_\d+)?$")


@dataclass
class SnapshotInfo:
    id: str
    timestamp: str
    files_count: int
    trigger: str = ""


def path_under_snapshots(rel: str) -> bool:
    """True if *rel* is inside ``.snapshots/`` (guard should skip)."""
    parts = Path(rel).parts
    return SNAPSHOTS_DIR in parts


def _is_text_snapshot_candidate(skill_dir: Path, path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        rel = path.relative_to(skill_dir)
    except ValueError:
        return False
    rel_s = str(rel)
    if path_under_snapshots(rel_s):
        return False
    ext = path.suffix.lower()
    if path.name != "SKILL.md" and ext not in TEXT_EXTENSIONS:
        return False
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return False
    except OSError:
        return False
    return True


def _iter_snapshot_source_files(skill_dir: Path) -> list[Path]:
    files: list[Path] = []
    if not skill_dir.is_dir():
        return files
    for f in skill_dir.rglob("*"):
        if _is_text_snapshot_candidate(skill_dir, f):
            files.append(f)
    return files


def _validate_skill_dir(skill_dir: Path) -> Path:
    resolved = Path(skill_dir).expanduser().resolve(strict=False)
    if not resolved.is_dir():
        raise ValueError(f"not a directory: {skill_dir}")
    return resolved


def _validate_snapshot_id(snapshot_id: str) -> str:
    sid = (snapshot_id or "").strip()
    if not _SNAPSHOT_ID_RE.match(sid):
        raise ValueError(f"invalid snapshot_id: {snapshot_id}")
    return sid


def _snapshot_root(skill_dir: Path) -> Path:
    return skill_dir / SNAPSHOTS_DIR


def _new_snapshot_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _allocate_snapshot_id(root: Path) -> str:
    base = _new_snapshot_id()
    sid = base
    n = 0
    while (root / sid).exists():
        n += 1
        sid = f"{base}_{n}"
    return sid


def _write_meta(
    dest: Path,
    *,
    skill_name: str,
    trigger: str,
    timestamp: str,
    files: list[str],
) -> None:
    meta = {
        "skill_name": skill_name,
        "trigger": trigger,
        "timestamp": timestamp,
        "files": files,
    }
    (dest / META_FILENAME).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_meta(snapshot_dir: Path) -> dict[str, Any]:
    meta_path = snapshot_dir / META_FILENAME
    if not meta_path.is_file():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _prune_old_snapshots(skill_dir: Path) -> None:
    root = _snapshot_root(skill_dir)
    if not root.is_dir():
        return
    dirs = [d for d in root.iterdir() if d.is_dir() and _SNAPSHOT_ID_RE.match(d.name)]
    dirs.sort(key=lambda d: d.name)
    while len(dirs) > MAX_SNAPSHOTS:
        oldest = dirs.pop(0)
        try:
            shutil.rmtree(oldest)
        except OSError:
            logger.warning("Failed to remove old snapshot %s", oldest, exc_info=True)


def create_snapshot(
    skill_dir: Path,
    *,
    trigger: str = "guard_ai_fix",
    skill_name: str = "",
) -> dict[str, Any]:
    """Copy text files into ``.snapshots/<id>/`` and prune to MAX_SNAPSHOTS."""
    skill_dir = _validate_skill_dir(skill_dir)
    root = _snapshot_root(skill_dir)
    root.mkdir(parents=True, exist_ok=True)
    snapshot_id = _allocate_snapshot_id(root)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dest = root / snapshot_id
    dest.mkdir(parents=True, exist_ok=False)

    copied: list[str] = []
    try:
        for src in _iter_snapshot_source_files(skill_dir):
            rel = src.relative_to(skill_dir)
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            copied.append(str(rel))

        _write_meta(
            dest,
            skill_name=skill_name or skill_dir.name,
            trigger=trigger,
            timestamp=timestamp,
            files=copied,
        )
        _prune_old_snapshots(skill_dir)
    except Exception:
        try:
            shutil.rmtree(dest, ignore_errors=True)
        except OSError:
            pass
        raise

    return {
        "snapshot_id": snapshot_id,
        "timestamp": timestamp,
        "files_count": len(copied),
    }


def list_snapshots(skill_dir: Path) -> list[SnapshotInfo]:
    """Return snapshots newest-first."""
    skill_dir = _validate_skill_dir(skill_dir)
    root = _snapshot_root(skill_dir)
    if not root.is_dir():
        return []
    entries: list[SnapshotInfo] = []
    for d in root.iterdir():
        if not d.is_dir() or not _SNAPSHOT_ID_RE.match(d.name):
            continue
        meta = _read_meta(d)
        files = meta.get("files") if isinstance(meta.get("files"), list) else []
        files_count = len(files)
        if not files_count:
            # count non-meta files
            files_count = sum(
                1 for f in d.rglob("*") if f.is_file() and f.name != META_FILENAME
            )
        entries.append(
            SnapshotInfo(
                id=d.name,
                timestamp=str(meta.get("timestamp") or d.name),
                files_count=files_count,
                trigger=str(meta.get("trigger") or ""),
            )
        )
    entries.sort(key=lambda e: e.id, reverse=True)
    return entries


def restore_snapshot(skill_dir: Path, snapshot_id: str) -> list[str]:
    """Overwrite skill files from snapshot; does not delete extra files."""
    skill_dir = _validate_skill_dir(skill_dir)
    sid = _validate_snapshot_id(snapshot_id)
    snap_dir = _snapshot_root(skill_dir) / sid
    if not snap_dir.is_dir():
        raise ValueError(f"snapshot not found: {snapshot_id}")

    restored: list[str] = []
    for f in snap_dir.rglob("*"):
        if not f.is_file() or f.name == META_FILENAME:
            continue
        rel = f.relative_to(snap_dir)
        if path_under_snapshots(str(rel)):
            continue
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
        restored.append(str(rel))

    meta = _read_meta(snap_dir)
    ts = meta.get("timestamp", sid)
    append_changelog(
        skill_dir,
        action="restore",
        author="user",
        summary=f"Restored from snapshot {sid} ({ts}), {len(restored)} file(s)",
    )
    return restored
