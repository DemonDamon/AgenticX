#!/usr/bin/env python3
"""Skill synchronization helpers for `.agents/skills` and `.claude/skills`.

Author: Damon Li
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Set


@dataclass
class SyncResult:
    synced: List[str] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


@dataclass
class CheckResult:
    in_sync: bool
    missing: List[str] = field(default_factory=list)
    outdated: List[str] = field(default_factory=list)
    extra: List[str] = field(default_factory=list)
    considered: List[str] = field(default_factory=list)


def sync_skills(
    source_dir: Path,
    target_dir: Path,
    public_skills_file: Optional[Path] = None,
) -> SyncResult:
    """Copy selected skills from source to target."""
    source_dir = source_dir.resolve()
    target_dir = target_dir.resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    result = SyncResult()
    allowed = _load_public_skill_set(public_skills_file)

    for skill_name in _list_skill_names(source_dir, allowed):
        source_skill = source_dir / skill_name
        target_skill = target_dir / skill_name
        try:
            if target_skill.exists() and _dirs_equal(source_skill, target_skill):
                result.skipped.append(skill_name)
                continue

            if target_skill.exists():
                shutil.rmtree(target_skill)
            shutil.copytree(source_skill, target_skill)
            result.synced.append(skill_name)
        except Exception:
            result.errors.append(skill_name)

    return result


def check_skills_sync(
    source_dir: Path,
    target_dir: Path,
    public_skills_file: Optional[Path] = None,
) -> CheckResult:
    """Check if selected skills are synchronized."""
    source_dir = source_dir.resolve()
    target_dir = target_dir.resolve()
    allowed = _load_public_skill_set(public_skills_file)

    source_names = set(_list_skill_names(source_dir, allowed))
    target_names = set(_list_skill_names(target_dir, allowed if allowed else None))

    missing = sorted(source_names - target_names)
    extra = sorted(target_names - source_names)

    outdated: List[str] = []
    for name in sorted(source_names & target_names):
        if not _dirs_equal(source_dir / name, target_dir / name):
            outdated.append(name)

    in_sync = not missing and not extra and not outdated
    return CheckResult(
        in_sync=in_sync,
        missing=missing,
        outdated=outdated,
        extra=extra,
        considered=sorted(source_names),
    )


def _load_public_skill_set(public_skills_file: Optional[Path]) -> Optional[Set[str]]:
    if public_skills_file is None:
        return None
    if not public_skills_file.exists():
        return None

    names: Set[str] = set()
    for raw in public_skills_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        names.add(line)
    return names


def _list_skill_names(base_dir: Path, allowed: Optional[Set[str]]) -> List[str]:
    if not base_dir.exists() or not base_dir.is_dir():
        return []
    names: List[str] = []
    for child in sorted(base_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        if allowed is not None and child.name not in allowed:
            continue
        names.append(child.name)
    return names


def _dirs_equal(left: Path, right: Path) -> bool:
    if not left.exists() or not right.exists() or not left.is_dir() or not right.is_dir():
        return False
    left_files = {
        p.relative_to(left).as_posix(): p for p in left.rglob("*") if p.is_file()
    }
    right_files = {
        p.relative_to(right).as_posix(): p for p in right.rglob("*") if p.is_file()
    }
    if set(left_files.keys()) != set(right_files.keys()):
        return False
    for rel in left_files:
        if left_files[rel].read_bytes() != right_files[rel].read_bytes():
            return False
    return True
