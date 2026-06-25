#!/usr/bin/env python3
"""Smoke tests for skill duplicate conflict resolution."""

from __future__ import annotations

from pathlib import Path

from agenticx.tools import skill_bundle as skill_bundle_module
from agenticx.tools.skill_bundle import SkillBundleLoader, infer_skill_source, resolve_skill_source


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
            [],
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


def test_infer_skill_source_recognizes_skillhub_home_path(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "home"
    skill_dir = home / "skills" / "frontend-slides"
    skill_dir.mkdir(parents=True)
    monkeypatch.setattr(skill_bundle_module.Path, "home", lambda: home)

    source = infer_skill_source(skill_dir)

    assert source == "skillhub"


def test_infer_skill_source_keeps_cursor_label_for_symlinked_skillhub_dir(
    tmp_path: Path,
    monkeypatch,
) -> None:
    home = tmp_path / "home"
    real_skill_dir = home / "skills" / "frontend-slides"
    cursor_root = home / ".cursor" / "skills"
    cursor_root.mkdir(parents=True)
    real_skill_dir.mkdir(parents=True)
    linked_skill_dir = cursor_root / "frontend-slides"
    linked_skill_dir.symlink_to(real_skill_dir, target_is_directory=True)
    monkeypatch.setattr(skill_bundle_module.Path, "home", lambda: home)

    source = infer_skill_source(linked_skill_dir)

    assert source == "cursor"


def test_resolve_skill_source_prefers_frontmatter_over_path(tmp_path: Path) -> None:
    skill_dir = tmp_path / ".agenticx" / "skills" / "ui-design"
    skill_dir.mkdir(parents=True)
    content = (
        "---\n"
        "name: ui-design\n"
        "description: third-party ui skill\n"
        "source: skillhub\n"
        "---\n\n"
        "# UI design\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

    loader = SkillBundleLoader(search_paths=[skill_dir.parent])
    meta = loader._parse_skill_md(skill_dir / "SKILL.md", skill_dir, "global")

    assert meta is not None
    assert meta.source == "skillhub"
    assert resolve_skill_source(skill_dir, "---\nname: ui-design\nsource: skillhub\n---") == "skillhub"


def test_resolve_skill_source_reads_provenance_sidecar(tmp_path: Path) -> None:
    from agenticx.skills.frontmatter import write_skill_provenance

    skill_dir = tmp_path / ".agenticx" / "skills" / "tencent-meeting-mcp"
    skill_dir.mkdir(parents=True)
    content = (
        "---\n"
        "name: tencent-meeting-mcp\n"
        "description: meeting skill\n"
        "---\n\n"
        "# Meeting\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    write_skill_provenance(skill_dir, "skillhub")

    loader = SkillBundleLoader(search_paths=[skill_dir.parent])
    meta = loader._parse_skill_md(skill_dir / "SKILL.md", skill_dir, "global")

    assert meta is not None
    assert meta.source == "skillhub"
