#!/usr/bin/env python3
"""Skill snapshot version storage and rollback helpers.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class SkillVersion:
    version: str
    created_at: str
    actor: str
    session_id: str
    content_sha256: str
    file_path: str
    summary: str


def versions_root(skills_root: Path) -> Path:
    return skills_root / ".versions"


def skill_versions_dir(skills_root: Path, skill_name: str) -> Path:
    return versions_root(skills_root) / skill_name


def save_snapshot(
    *,
    skills_root: Path,
    skill_name: str,
    content: str,
    actor: str = "agent",
    session_id: str = "",
    summary: str = "",
) -> SkillVersion:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    version = f"{ts}-{digest[:10]}"
    target_dir = skill_versions_dir(skills_root, skill_name)
    target_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{version}.md"
    file_path = target_dir / file_name
    file_path.write_text(content, encoding="utf-8")
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = SkillVersion(
        version=version,
        created_at=created_at,
        actor=actor,
        session_id=session_id,
        content_sha256=digest,
        file_path=str(file_path),
        summary=summary,
    )
    _append_index(target_dir, meta)
    return meta


def list_versions(
    *,
    skills_root: Path,
    skill_name: str,
    limit: int = 50,
) -> list[SkillVersion]:
    target_dir = skill_versions_dir(skills_root, skill_name)
    idx = target_dir / "index.jsonl"
    if not idx.is_file():
        return []
    out: list[SkillVersion] = []
    for line in idx.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj: dict[str, Any] = json.loads(line)
            out.append(
                SkillVersion(
                    version=str(obj.get("version", "")),
                    created_at=str(obj.get("created_at", "")),
                    actor=str(obj.get("actor", "agent")),
                    session_id=str(obj.get("session_id", "")),
                    content_sha256=str(obj.get("content_sha256", "")),
                    file_path=str(obj.get("file_path", "")),
                    summary=str(obj.get("summary", "")),
                )
            )
        except Exception:
            continue
    out.sort(key=lambda x: x.version, reverse=True)
    return out[: max(1, min(limit, 200))]


def get_version_content(
    *,
    skills_root: Path,
    skill_name: str,
    version: str,
) -> str:
    target_dir = skill_versions_dir(skills_root, skill_name)
    file_path = target_dir / f"{version}.md"
    if not file_path.is_file():
        raise FileNotFoundError(f"version not found: {version}")
    return file_path.read_text(encoding="utf-8")


def _append_index(target_dir: Path, version: SkillVersion) -> None:
    idx = target_dir / "index.jsonl"
    payload = {
        "version": version.version,
        "created_at": version.created_at,
        "actor": version.actor,
        "session_id": version.session_id,
        "content_sha256": version.content_sha256,
        "file_path": version.file_path,
        "summary": version.summary,
    }
    with idx.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
