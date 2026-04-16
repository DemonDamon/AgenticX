#!/usr/bin/env python3
"""Skill deprecation analysis — flag underperforming skills.

Combines ``SkillUsageTracker.get_deprecation_candidates`` with per-skill
statistics to produce an actionable report for the agent or user.

Upstream reference: hermes-agent proposal v2 Phase 3.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from agenticx.learning.skill_usage_tracker import (
    get_deprecation_candidates,
    get_stats,
)

logger = logging.getLogger("agenticx.learning")


def check_deprecation(
    skills_root: Path | None = None,
    *,
    min_uses: int = 5,
    max_success_rate: float = 0.3,
) -> list[dict[str, Any]]:
    """Return structured deprecation report for underperforming skills.

    Each entry includes the skill name, use count, success rate, and a
    suggested action (``update`` or ``remove``).
    """
    if skills_root is None:
        skills_root = Path.home() / ".agenticx" / "skills"
    candidates = get_deprecation_candidates(
        skills_root, min_uses=min_uses, max_success_rate=max_success_rate,
    )
    report: list[dict[str, Any]] = []
    for name in candidates:
        skill_dir = skills_root / name
        stats = get_stats(skill_dir, skill_name=name)
        report.append({
            "skill_name": name,
            "use_count": stats.use_count,
            "success_rate": round(stats.success_rate, 3),
            "failure_count": stats.failure_count,
            "suggested_action": "update" if stats.success_rate > 0.1 else "remove",
        })
    return report


def check_deprecation_json(
    skills_root: Path | None = None,
    *,
    min_uses: int = 5,
    max_success_rate: float = 0.3,
) -> str:
    """JSON-serialized deprecation report (suitable for tool result)."""
    report = check_deprecation(skills_root, min_uses=min_uses, max_success_rate=max_success_rate)
    if not report:
        return json.dumps({"status": "ok", "message": "No underperforming skills found.", "candidates": []}, ensure_ascii=False)
    return json.dumps({
        "status": "action_needed",
        "message": f"{len(report)} skill(s) may need attention.",
        "candidates": report,
    }, ensure_ascii=False)
