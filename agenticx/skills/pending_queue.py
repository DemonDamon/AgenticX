#!/usr/bin/env python3
"""Pending skill proposal queue: list / approve / reject.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.skills.pending")

PROPOSALS_DIRNAME = ".proposals"


def _proposals_root() -> Path:
    from agenticx.learning.gepa_proposer import proposals_root

    return proposals_root()


def _read_proposal_meta(pdir: Path) -> dict[str, Any] | None:
    meta_path = pdir / "proposal.json"
    if not meta_path.is_file():
        return None
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def cleanup_stale(max_age_days: int = 30) -> int:
    """Delete pending proposals older than ``max_age_days``. Return count removed."""
    root = _proposals_root()
    if not root.is_dir():
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    removed = 0
    for pdir in root.iterdir():
        if not pdir.is_dir():
            continue
        meta = _read_proposal_meta(pdir)
        if meta is None:
            continue
        created = str(meta.get("created_at", "") or "")
        try:
            ts = datetime.strptime(created, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if ts < cutoff and str(meta.get("status", "")) == "pending":
            shutil.rmtree(pdir, ignore_errors=True)
            removed += 1
    return removed


def list_pending() -> list[dict[str, Any]]:
    """Return pending proposals sorted by ``created_at`` descending."""
    cleanup_stale()
    root = _proposals_root()
    if not root.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for pdir in root.iterdir():
        if not pdir.is_dir():
            continue
        meta = _read_proposal_meta(pdir)
        if meta is None:
            continue
        if str(meta.get("status", "pending")) != "pending":
            continue
        meta = dict(meta)
        meta["proposal_dir"] = str(pdir)
        rows.append(meta)
    rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
    return rows


def approve(proposal_id: str, *, approver: str = "user") -> dict[str, Any]:
    """Merge a pending proposal into the main skills directory."""
    from agenticx.learning.config import get_learning_config
    from agenticx.learning.skill_quality_gate import check_size_limits
    from agenticx.skills.frontmatter import (
        SkillFrontmatterError,
        get_description_from_frontmatter,
        normalize_skill_md,
    )
    from agenticx.skills.guard import scan_skill, should_allow
    from agenticx.skills.versioning import append_changelog

    root = _proposals_root()
    pdir = root / proposal_id
    meta = _read_proposal_meta(pdir)
    if meta is None:
        return {"ok": False, "error": "proposal not found"}
    skill_md_path = pdir / "SKILL.md"
    if not skill_md_path.is_file():
        return {"ok": False, "error": "SKILL.md missing in proposal"}

    name = str(meta.get("base_skill", "") or "").strip()
    if not name:
        return {"ok": False, "error": "base_skill missing"}

    content = skill_md_path.read_text(encoding="utf-8")
    cfg = get_learning_config()
    desc = get_description_from_frontmatter(content) or ""
    size_check = check_size_limits(
        content,
        desc,
        max_bytes=int(cfg.get("max_skill_bytes", 15360)),
        max_desc_chars=int(cfg.get("max_description_chars", 500)),
    )
    if not size_check["ok"]:
        return {"ok": False, "error": f"{size_check['error']}. {size_check['hint']}"}

    try:
        normalized, _ = normalize_skill_md(content, name)
    except SkillFrontmatterError as exc:
        return {"ok": False, "error": str(exc)}

    skills_root = Path.home() / ".agenticx" / "skills"
    skill_dir = (skills_root / name).resolve()
    try:
        skill_dir.relative_to(skills_root.resolve())
    except ValueError:
        return {"ok": False, "error": "skill path outside skills root"}

    action = str(meta.get("action", "create") or "create")
    if action == "create" and skill_dir.exists():
        return {"ok": False, "error": "skill already exists"}

    skill_dir.mkdir(parents=True, exist_ok=True)
    target = skill_dir / "SKILL.md"
    try:
        target.write_text(normalized, encoding="utf-8")
        result = scan_skill(skill_dir, source="agent-created")
        ok, reason = should_allow(result, "agent-created")
        if not ok:
            if action == "create":
                shutil.rmtree(skill_dir, ignore_errors=True)
            else:
                target.unlink(missing_ok=True)
            return {"ok": False, "error": reason}
        append_changelog(
            skill_dir,
            action="approved",
            author=approver,
            summary=f"merged proposal {proposal_id} ({action})",
        )
        shutil.rmtree(pdir, ignore_errors=True)
        return {"ok": True, "skill_name": name, "path": str(target)}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def reject(proposal_id: str, *, reason: str = "") -> dict[str, Any]:
    """Delete a pending proposal directory."""
    root = _proposals_root()
    pdir = root / proposal_id
    if not pdir.is_dir():
        return {"ok": False, "error": "proposal not found"}
    meta = _read_proposal_meta(pdir)
    if meta and reason:
        meta["reject_reason"] = reason
        meta["status"] = "rejected"
        try:
            (pdir / "proposal.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass
    shutil.rmtree(pdir, ignore_errors=True)
    return {"ok": True, "proposal_id": proposal_id}
