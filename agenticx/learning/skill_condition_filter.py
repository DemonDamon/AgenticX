#!/usr/bin/env python3
"""Conditional metadata filter for skill index visibility.

Evaluates ``requires_tools``, ``requires_toolsets``, and ``fallback_for``
fields from SKILL.md frontmatter to decide whether a skill should appear
in the active session's skill index.

Usage:
    from agenticx.learning.skill_condition_filter import filter_skills

    visible = filter_skills(
        all_skills,
        available_tools={"bash_exec", "file_read"},
        available_toolsets={"browser", "terminal"},
    )

Upstream reference: hermes-agent ``agent/prompt_builder.py:550-578``
(``_skill_should_show``).

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning")


def _extract_frontmatter_block(content: str) -> str:
    """Return the raw YAML frontmatter text between ``---`` markers."""
    stripped = content.strip()
    if not stripped.startswith("---"):
        return ""
    end = re.search(r"\n---\s*\n", stripped[3:])
    if not end:
        return ""
    return stripped[3 : 3 + end.start()]


def _parse_list_field(fm_text: str, field: str) -> list[str]:
    """Parse a YAML list field from frontmatter text (simple regex, no yaml dep)."""
    pattern = re.compile(rf"^\s*{re.escape(field)}\s*:\s*\[([^\]]*)\]", re.MULTILINE)
    m = pattern.search(fm_text)
    if m:
        raw = m.group(1)
        return [s.strip().strip("\"'") for s in raw.split(",") if s.strip()]
    items: list[str] = []
    in_field = False
    for line in fm_text.splitlines():
        if re.match(rf"^\s*{re.escape(field)}\s*:", line):
            in_field = True
            continue
        if in_field:
            if line.strip().startswith("- "):
                items.append(line.strip()[2:].strip().strip("\"'"))
            else:
                break
    return items


def extract_conditions(skill_md_path: Path) -> dict[str, list[str]]:
    """Extract condition fields from a SKILL.md file.

    Returns a dict with keys ``requires_tools``, ``requires_toolsets``,
    ``fallback_for_tools``, ``fallback_for_toolsets`` — each a list of
    identifiers or empty.
    """
    try:
        content = skill_md_path.read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return {}
    fm = _extract_frontmatter_block(content)
    if not fm:
        return {}
    return {
        "requires_tools": _parse_list_field(fm, "requires_tools"),
        "requires_toolsets": _parse_list_field(fm, "requires_toolsets"),
        "fallback_for_tools": _parse_list_field(fm, "fallback_for_tools"),
        "fallback_for_toolsets": _parse_list_field(fm, "fallback_for_toolsets"),
    }


def skill_should_show(
    conditions: dict[str, list[str]],
    available_tools: set[str] | None = None,
    available_toolsets: set[str] | None = None,
) -> bool:
    """Decide whether a skill should appear in the session index.

    Logic (mirrors Hermes ``_skill_should_show``):
    - ``fallback_for_tools``: hide when the primary tool IS available
    - ``fallback_for_toolsets``: hide when the primary toolset IS available
    - ``requires_tools``: hide when a required tool is NOT available
    - ``requires_toolsets``: hide when a required toolset is NOT available
    - If no conditions → always show
    """
    fb_tools = conditions.get("fallback_for_tools", [])
    fb_toolsets = conditions.get("fallback_for_toolsets", [])
    req_tools = conditions.get("requires_tools", [])
    req_toolsets = conditions.get("requires_toolsets", [])

    if not any([fb_tools, fb_toolsets, req_tools, req_toolsets]):
        return True

    if available_tools is not None:
        for t in fb_tools:
            if t in available_tools:
                return False
        for t in req_tools:
            if t not in available_tools:
                return False

    if available_toolsets is not None:
        for ts in fb_toolsets:
            if ts in available_toolsets:
                return False
        for ts in req_toolsets:
            if ts not in available_toolsets:
                return False

    return True


def filter_skills(
    skills: list[dict[str, Any]],
    available_tools: set[str] | None = None,
    available_toolsets: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Filter a skill summary list, removing skills whose conditions fail.

    Each skill dict should have ``skill_md_path`` (str) for condition extraction,
    or pre-populated ``conditions`` (dict).  Skills without conditions pass through.
    """
    result: list[dict[str, Any]] = []
    for skill in skills:
        conds = skill.get("conditions")
        if conds is None:
            md_path = skill.get("skill_md_path", "")
            if md_path:
                conds = extract_conditions(Path(md_path))
            else:
                conds = {}
        if skill_should_show(conds, available_tools, available_toolsets):
            result.append(skill)
    return result
