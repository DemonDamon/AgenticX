#!/usr/bin/env python3
"""Track skill usage and effectiveness for auto-improvement signals.

Records each ``skill_use`` invocation and its session outcome into a
per-skill ``.usage_stats.json`` file.  Provides aggregate queries for
success rate, use count, and deprecation candidates.

Upstream reference: hermes-agent proposal v2 §4.2.3.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning")

STATS_FILENAME = ".usage_stats.json"


@dataclass
class SkillStats:
    """Aggregate usage statistics for a single skill."""

    skill_name: str
    use_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    unknown_count: int = 0
    total_tool_calls_after: int = 0

    @property
    def success_rate(self) -> float:
        determined = self.success_count + self.failure_count
        if determined == 0:
            return 0.0
        return self.success_count / determined

    @property
    def avg_tool_calls_after(self) -> float:
        if self.use_count == 0:
            return 0.0
        return self.total_tool_calls_after / self.use_count


def _stats_path(skill_dir: Path) -> Path:
    return Path(skill_dir) / STATS_FILENAME


def _load_raw(skill_dir: Path) -> dict[str, Any]:
    p = _stats_path(skill_dir)
    if not p.is_file():
        return {"uses": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"uses": []}
        return data
    except (json.JSONDecodeError, ValueError, OSError):
        return {"uses": []}


def _save_raw(skill_dir: Path, data: dict[str, Any]) -> None:
    p = _stats_path(skill_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def record_use(
    skill_dir: Path,
    *,
    session_id: str = "",
    success: bool | None = None,
    tool_calls_after: int = 0,
) -> None:
    """Append a usage event to the skill's stats file.

    Args:
        skill_dir: Skill directory (contains SKILL.md).
        session_id: Originating session.
        success: Whether the task succeeded after loading the skill.
            ``None`` means outcome unknown / session still active.
        tool_calls_after: Number of tool calls after loading the skill.
    """
    data = _load_raw(skill_dir)
    uses = data.get("uses", [])
    if not isinstance(uses, list):
        uses = []
    uses.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "session_id": session_id,
        "success": success,
        "tool_calls_after": tool_calls_after,
    })
    data["uses"] = uses
    _save_raw(skill_dir, data)


def get_stats(skill_dir: Path, skill_name: str = "") -> SkillStats:
    """Compute aggregate statistics from recorded usage events."""
    data = _load_raw(skill_dir)
    uses = data.get("uses", [])
    if not isinstance(uses, list):
        uses = []
    stats = SkillStats(skill_name=skill_name or Path(skill_dir).name)
    for u in uses:
        stats.use_count += 1
        s = u.get("success")
        if s is True:
            stats.success_count += 1
        elif s is False:
            stats.failure_count += 1
        else:
            stats.unknown_count += 1
        stats.total_tool_calls_after += int(u.get("tool_calls_after", 0))
    return stats


def get_deprecation_candidates(
    skills_root: Path,
    *,
    min_uses: int = 5,
    max_success_rate: float = 0.3,
) -> list[str]:
    """Find skills that may need update or deprecation.

    A skill is flagged when it has been used ``min_uses`` times or more
    and its success rate is at or below ``max_success_rate``.

    Args:
        skills_root: Parent directory containing skill subdirectories.
        min_uses: Minimum number of recorded uses to consider.
        max_success_rate: Threshold below which a skill is flagged.

    Returns:
        List of skill directory names that are deprecation candidates.
    """
    candidates: list[str] = []
    root = Path(skills_root)
    if not root.is_dir():
        return candidates
    for child in root.iterdir():
        if not child.is_dir():
            continue
        stats_file = child / STATS_FILENAME
        if not stats_file.is_file():
            continue
        stats = get_stats(child, skill_name=child.name)
        if stats.use_count >= min_uses and stats.success_rate <= max_success_rate:
            candidates.append(child.name)
    return sorted(candidates)
