#!/usr/bin/env python3
"""Smoke tests for skill condition metadata filter.

Validates hermes-agent proposal v2 — conditional metadata filtering
(requires_tools / fallback_for) aligned with Hermes ``_skill_should_show``.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.learning.skill_condition_filter import (
    extract_conditions,
    filter_skills,
    skill_should_show,
)


class TestSkillShouldShow:
    def test_no_conditions(self) -> None:
        assert skill_should_show({}) is True

    def test_requires_tools_present(self) -> None:
        conds = {"requires_tools": ["bash_exec"]}
        assert skill_should_show(conds, available_tools={"bash_exec", "file_read"}) is True

    def test_requires_tools_missing(self) -> None:
        conds = {"requires_tools": ["browser_use"]}
        assert skill_should_show(conds, available_tools={"bash_exec"}) is False

    def test_fallback_for_tools_primary_available(self) -> None:
        conds = {"fallback_for_tools": ["browser_use"]}
        assert skill_should_show(conds, available_tools={"browser_use"}) is False

    def test_fallback_for_tools_primary_missing(self) -> None:
        conds = {"fallback_for_tools": ["browser_use"]}
        assert skill_should_show(conds, available_tools={"bash_exec"}) is True

    def test_requires_toolsets_present(self) -> None:
        conds = {"requires_toolsets": ["terminal"]}
        assert skill_should_show(conds, available_toolsets={"terminal", "browser"}) is True

    def test_requires_toolsets_missing(self) -> None:
        conds = {"requires_toolsets": ["browser"]}
        assert skill_should_show(conds, available_toolsets={"terminal"}) is False

    def test_fallback_for_toolsets_primary_available(self) -> None:
        conds = {"fallback_for_toolsets": ["browser"]}
        assert skill_should_show(conds, available_toolsets={"browser"}) is False

    def test_none_tool_sets_ignored(self) -> None:
        conds = {"requires_tools": ["bash_exec"]}
        assert skill_should_show(conds, available_tools=None) is True


class TestExtractConditions:
    def test_inline_list(self, tmp_path: Path) -> None:
        md = tmp_path / "SKILL.md"
        md.write_text(
            "---\n"
            "name: test\n"
            "description: test\n"
            'requires_tools: ["bash_exec", "file_read"]\n'
            'fallback_for_tools: ["browser_use"]\n'
            "---\n\nBody.\n"
        )
        conds = extract_conditions(md)
        assert conds["requires_tools"] == ["bash_exec", "file_read"]
        assert conds["fallback_for_tools"] == ["browser_use"]

    def test_yaml_list(self, tmp_path: Path) -> None:
        md = tmp_path / "SKILL.md"
        md.write_text(
            "---\n"
            "name: test\n"
            "description: test\n"
            "requires_toolsets:\n"
            "  - terminal\n"
            "  - browser\n"
            "---\n\nBody.\n"
        )
        conds = extract_conditions(md)
        assert conds["requires_toolsets"] == ["terminal", "browser"]

    def test_no_conditions(self, tmp_path: Path) -> None:
        md = tmp_path / "SKILL.md"
        md.write_text("---\nname: test\ndescription: test\n---\n\nBody.\n")
        conds = extract_conditions(md)
        assert conds.get("requires_tools", []) == []
        assert conds.get("fallback_for_tools", []) == []

    def test_missing_file(self, tmp_path: Path) -> None:
        conds = extract_conditions(tmp_path / "nope.md")
        assert conds == {}


class TestFilterSkills:
    def test_filters_by_requires(self, tmp_path: Path) -> None:
        skill_a = tmp_path / "skill-a" / "SKILL.md"
        skill_a.parent.mkdir()
        skill_a.write_text('---\nname: a\ndescription: a\nrequires_tools: ["browser_use"]\n---\n\nBody.\n')

        skill_b = tmp_path / "skill-b" / "SKILL.md"
        skill_b.parent.mkdir()
        skill_b.write_text("---\nname: b\ndescription: b\n---\n\nBody.\n")

        skills = [
            {"name": "a", "skill_md_path": str(skill_a)},
            {"name": "b", "skill_md_path": str(skill_b)},
        ]
        visible = filter_skills(skills, available_tools={"bash_exec"})
        names = [s["name"] for s in visible]
        assert "a" not in names
        assert "b" in names

    def test_fallback_hidden_when_primary_available(self, tmp_path: Path) -> None:
        md = tmp_path / "fallback" / "SKILL.md"
        md.parent.mkdir()
        md.write_text('---\nname: fallback\ndescription: fb\nfallback_for_tools: ["browser_use"]\n---\n\nBody.\n')
        skills = [{"name": "fallback", "skill_md_path": str(md)}]
        assert len(filter_skills(skills, available_tools={"browser_use"})) == 0
        assert len(filter_skills(skills, available_tools={"bash_exec"})) == 1

    def test_precomputed_conditions(self) -> None:
        skills = [
            {"name": "a", "conditions": {"requires_tools": ["magic_tool"]}},
            {"name": "b", "conditions": {}},
        ]
        visible = filter_skills(skills, available_tools={"bash_exec"})
        assert len(visible) == 1
        assert visible[0]["name"] == "b"
