"""Smoke tests for `.agents/skills` compatibility in SkillBundleLoader."""

from __future__ import annotations

from pathlib import Path

from agenticx.tools.skill_bundle import SkillBundleLoader


def _write_skill(base: Path, name: str, description: str) -> None:
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"""---
name: {name}
description: {description}
---

# {name}
""",
        encoding="utf-8",
    )


def test_agents_skills_discovery(tmp_path: Path) -> None:
    agents_dir = tmp_path / ".agents" / "skills"
    _write_skill(agents_dir, "skill-a", "from agents")

    loader = SkillBundleLoader(search_paths=[agents_dir])
    skills = loader.scan()

    assert len(skills) == 1
    assert skills[0].name == "skill-a"
    assert skills[0].description == "from agents"


def test_agents_path_has_higher_priority_than_claude(tmp_path: Path) -> None:
    agents_dir = tmp_path / ".agents" / "skills"
    claude_dir = tmp_path / ".claude" / "skills"

    _write_skill(agents_dir, "same-skill", "preferred agents")
    _write_skill(claude_dir, "same-skill", "fallback claude")

    loader = SkillBundleLoader(search_paths=[agents_dir, claude_dir])
    skills = loader.scan()

    assert len(skills) == 1
    assert skills[0].name == "same-skill"
    assert skills[0].description == "preferred agents"
