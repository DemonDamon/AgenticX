#!/usr/bin/env python3
"""Skill changelog / versioning utilities.

Appends structured changelog entries alongside SKILL.md so that every
create / patch / edit / delete action is traceable.

Changelog file: ``<skill_dir>/.changelog``

Upstream reference: hermes-agent proposal v2 §4.2.6.

Author: Damon Li
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.skills")

CHANGELOG_FILENAME = ".changelog"


def append_changelog(
    skill_dir: Path,
    *,
    action: str,
    session_id: str = "",
    author: str = "agent",
    summary: str = "",
) -> None:
    """Append a changelog entry to the skill's ``.changelog`` file.

    Args:
        skill_dir: Skill directory containing SKILL.md.
        action: One of ``create``, ``patch``, ``edit``, ``delete``.
        session_id: Session that triggered the change.
        author: Human-readable author label.
        summary: Brief description of what changed.
    """
    skill_dir = Path(skill_dir)
    changelog = skill_dir / CHANGELOG_FILENAME
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        f"## [{ts}] {action}",
        f"- Author: {author}" + (f" (session: {session_id})" if session_id else ""),
    ]
    if summary:
        lines.append(f"- Summary: {summary}")
    lines.append("")
    entry = "\n".join(lines) + "\n"
    try:
        skill_dir.mkdir(parents=True, exist_ok=True)
        with changelog.open("a", encoding="utf-8") as fh:
            fh.write(entry)
    except OSError:
        logger.warning("Failed to write changelog for %s", skill_dir, exc_info=True)


def read_changelog(skill_dir: Path) -> str:
    """Read the full changelog text, or empty string if absent."""
    changelog = Path(skill_dir) / CHANGELOG_FILENAME
    if not changelog.is_file():
        return ""
    try:
        return changelog.read_text(encoding="utf-8")
    except OSError:
        return ""


def changelog_entry_count(skill_dir: Path) -> int:
    """Count the number of changelog entries (== number of ``## [`` headers)."""
    text = read_changelog(skill_dir)
    if not text:
        return 0
    return text.count("## [")
