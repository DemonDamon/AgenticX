#!/usr/bin/env python3
"""Smoke tests for skill duplicate conflict resolution."""

from __future__ import annotations

from pathlib import Path

from agenticx.tools import skill_bundle as skill_bundle_module
from agenticx.tools.skill_bundle import SkillBundleLoader


def _write_skill(root: Path, name: str, description: str, body: str) -> None:
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    content = (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "---\n\n"
        f"{body}\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def _force_presets_enabled(monkeypatch) -> None:
    monkeypatch.setattr(
        skill_bundle_module,
        "get_skill_scan_settings_from_config",
        lambda: (
            [
                {"id": "cursor_skills", "label": "Cursor Skills", "path": "~/.cursor/skills", "enabled": True},
                {"id": "claude_skills_home", "label": "Claude Skills", "path": "~/.claude/skills", "enabled": True},
                {"id": "agents_home", "label": "Agents Global", "path": "~/.agents/skills", "enabled": True},
            ],
            [],
            {},
        ),
    )


def test_duplicate_skill_prefers_higher_source_priority(tmp_path: Path, monkeypatch) -> None:
    _force_presets_enabled(monkeypatch)
    cursor_root = tmp_path / ".cursor" / "skills"
    claude_root = tmp_path / ".claude" / "skills"
    _write_skill(cursor_root, "tech-daily-news", "cursor variant", "# Cursor version")
    _write_skill(claude_root, "tech-daily-news", "claude variant", "# Claude version")

    loader = SkillBundleLoader(search_paths=[claude_root, cursor_root])
    skills = loader.scan()
    assert len(skills) == 1
    assert skills[0].name == "tech-daily-news"
    assert skills[0].source == "cursor"


def test_duplicate_skill_respects_user_preferred_source(tmp_path: Path, monkeypatch) -> None:
    _force_presets_enabled(monkeypatch)
    cursor_root = tmp_path / ".cursor" / "skills"
    claude_root = tmp_path / ".claude" / "skills"
    _write_skill(cursor_root, "tech-daily-news", "cursor variant", "# Cursor version")
    _write_skill(claude_root, "tech-daily-news", "claude variant", "# Claude version")

    loader = SkillBundleLoader(
        search_paths=[cursor_root, claude_root],
        preferred_sources={"tech-daily-news": "claude"},
    )
    skills = loader.scan()
    assert len(skills) == 1
    assert skills[0].source == "claude"
    assert "Claude version" in skills[0].skill_md_path.read_text(encoding="utf-8")


def test_duplicate_skill_keeps_variants_with_content_hashes(tmp_path: Path, monkeypatch) -> None:
    _force_presets_enabled(monkeypatch)
    cursor_root = tmp_path / ".cursor" / "skills"
    agents_root = tmp_path / ".agents" / "skills"
    _write_skill(cursor_root, "tech-daily-news", "cursor variant", "# Cursor version")
    _write_skill(agents_root, "tech-daily-news", "agents variant", "# Agents version")

    loader = SkillBundleLoader(search_paths=[cursor_root, agents_root])
    loader.scan()

    variants = loader.get_skill_variants("tech-daily-news")
    assert len(variants) == 2
    hashes = {v.content_hash for v in variants}
    assert len(hashes) == 2
    assert all(len(h) == 64 for h in hashes)
