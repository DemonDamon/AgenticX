#!/usr/bin/env python3
"""SKILL.md frontmatter normalization and discoverability checks.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional, Tuple

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)

_DEFAULT_DESCRIPTION = "TODO: describe when to use this skill"


class SkillFrontmatterError(ValueError):
    """Raised when SKILL.md frontmatter cannot be normalized."""


def _extract_frontmatter_block(content: str) -> Optional[str]:
    match = _FRONTMATTER_RE.match(content.strip())
    if not match:
        return None
    return match.group(1)


def _frontmatter_get_scalar(fm_text: str, key: str) -> Optional[str]:
    pattern = re.compile(rf"^{re.escape(key)}:\s*(.+?)\s*$", re.MULTILINE)
    match = pattern.search(fm_text)
    if not match:
        return None
    return match.group(1).strip()


def _set_or_insert_frontmatter_field(fm_text: str, key: str, value: str) -> Tuple[str, bool]:
    """Return updated frontmatter body and whether a change was made."""
    pattern = re.compile(rf"^{re.escape(key)}:\s*.+?\s*$", re.MULTILINE)
    replacement = f"{key}: {value}"
    if pattern.search(fm_text):
        new_text = pattern.sub(replacement, fm_text, count=1)
        changed = new_text != fm_text
        return new_text, changed
    if fm_text.strip():
        return f"{key}: {value}\n{fm_text}", True
    return f"{key}: {value}", True


def normalize_skill_md(content: str, canonical_name: str) -> Tuple[str, List[str]]:
    """Normalize SKILL.md YAML frontmatter before persisting via skill_manage.

    Args:
        content: Full SKILL.md text.
        canonical_name: Directory/tool name; used as authoritative ``name`` field.

    Returns:
        Tuple of (normalized_content, list of human-readable fix notes).

    Raises:
        SkillFrontmatterError: When frontmatter delimiters are missing.
    """
    text = content if content.endswith("\n") else content + "\n"
    fm_block = _extract_frontmatter_block(text)
    if fm_block is None:
        raise SkillFrontmatterError("SKILL.md must start with YAML frontmatter (---)")

    fixed: List[str] = []
    fm_text = fm_block

    existing_name = _frontmatter_get_scalar(fm_text, "name")
    if existing_name is None:
        fm_text, _ = _set_or_insert_frontmatter_field(fm_text, "name", canonical_name)
        fixed.append(f"injected name: {canonical_name}")
    elif existing_name != canonical_name:
        fm_text, _ = _set_or_insert_frontmatter_field(fm_text, "name", canonical_name)
        fixed.append(f"aligned name to tool param: {canonical_name}")

    existing_desc = _frontmatter_get_scalar(fm_text, "description")
    if not existing_desc:
        fm_text, _ = _set_or_insert_frontmatter_field(fm_text, "description", _DEFAULT_DESCRIPTION)
        fixed.append("injected placeholder description")

    body_match = _FRONTMATTER_RE.match(text.strip())
    if not body_match:
        raise SkillFrontmatterError("invalid frontmatter structure")
    trailing = text.strip()[body_match.end() :]
    if trailing and not trailing.startswith("\n"):
        trailing = "\n" + trailing
    normalized = f"---\n{fm_text.rstrip()}\n---{trailing}"
    if not normalized.endswith("\n"):
        normalized += "\n"
    return normalized, fixed


def get_description_from_frontmatter(content: str) -> Optional[str]:
    """Return the ``description`` scalar from SKILL.md frontmatter, if present."""
    fm_block = _extract_frontmatter_block(content)
    if fm_block is None:
        return None
    return _frontmatter_get_scalar(fm_block, "description")


def validate_skill_frontmatter(content: str) -> List[str]:
    """Return validation error messages for SKILL.md frontmatter (empty if ok)."""
    errors: List[str] = []
    fm_block = _extract_frontmatter_block(content)
    if fm_block is None:
        errors.append("missing YAML frontmatter")
        return errors
    name = _frontmatter_get_scalar(fm_block, "name")
    if not name:
        errors.append("missing name in frontmatter")
    desc = _frontmatter_get_scalar(fm_block, "description")
    if not desc:
        errors.append("missing description in frontmatter")
    return errors


def verify_skill_discoverable(skill_dir: Path) -> Tuple[bool, Optional[str], List[str]]:
    """Check whether SkillBundleLoader can parse the skill at ``skill_dir``.

    Returns:
        (discoverable, skill_name, errors)
    """
    skill_md = skill_dir / "SKILL.md"
    errors: List[str] = []
    if not skill_md.is_file():
        return False, None, ["SKILL.md not found"]

    try:
        content = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        return False, None, [f"read failed: {exc}"]

    errors.extend(validate_skill_frontmatter(content))
    if errors:
        return False, None, errors

    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader()
    meta = loader._parse_skill_md(skill_md, skill_dir, "global")
    if meta is None:
        return False, None, ["SkillBundleLoader failed to parse SKILL.md"]
    return True, meta.name, []
