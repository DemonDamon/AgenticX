#!/usr/bin/env python3
"""Smoke tests for extended SKILL.md metadata parsing.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.tools.skill_bundle import SkillBundleLoader, SkillTool


def _write_skill(skill_dir: Path, frontmatter: str, body: str = "# Instruction\n") -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    content = f"---\n{frontmatter}\n---\n\n{body}"
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def test_skill_metadata_parses_extended_fields(tmp_path: Path) -> None:
    _write_skill(
        tmp_path / "demo_ext",
        "\n".join(
            [
                "name: demo_ext",
                "description: Demo skill",
                "tag: office-collab",
                "icon: Table2",
                "examples: [foo, bar]",
                "requires:",
                "  tools: [read_file, write_file]",
                "  plugins: [@larksuite/openclaw-lark]",
            ],
        ),
    )

    loader = SkillBundleLoader(search_paths=[tmp_path])
    skills = loader.scan()
    assert len(skills) == 1
    skill = skills[0]
    assert skill.name == "demo_ext"
    assert skill.tag == "office-collab"
    assert skill.icon == "Table2"
    assert skill.examples == ["foo", "bar"]
    assert skill.requires == {
        "tools": ["read_file", "write_file"],
        "plugins": ["@larksuite/openclaw-lark"],
    }


def test_skill_metadata_backward_compatible_defaults(tmp_path: Path) -> None:
    _write_skill(
        tmp_path / "demo_old",
        "\n".join(
            [
                "name: demo_old",
                "description: Old style skill",
            ],
        ),
    )
    loader = SkillBundleLoader(search_paths=[tmp_path])
    skills = loader.scan()
    assert len(skills) == 1
    skill = skills[0]
    assert skill.tag is None
    assert skill.icon is None
    assert skill.examples == []
    assert skill.requires == {}


def test_skill_list_output_includes_tag_and_icon(tmp_path: Path) -> None:
    _write_skill(
        tmp_path / "demo_list",
        "\n".join(
            [
                "name: demo_list",
                "description: Skill with display fields",
                "tag: dev-tools",
                "icon: Wrench",
            ],
        ),
    )
    loader = SkillBundleLoader(search_paths=[tmp_path])
    tool = SkillTool(loader=loader)
    output = tool._handle_list()
    assert "demo_list" in output
    assert "tag=dev-tools" in output
    assert "icon=Wrench" in output


def test_skill_metadata_ignores_body_tag_icon_lines(tmp_path: Path) -> None:
    _write_skill(
        tmp_path / "demo_body_noise",
        "\n".join(
            [
                "name: demo_body_noise",
                "description: metadata only",
            ],
        ),
        body="# Body\n\ntag: not-metadata\nicon: fake\n",
    )
    loader = SkillBundleLoader(search_paths=[tmp_path])
    skills = loader.scan()
    assert len(skills) == 1
    skill = skills[0]
    assert skill.tag is None
    assert skill.icon is None
