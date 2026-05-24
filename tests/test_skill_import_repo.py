#!/usr/bin/env python3
"""Tests for skill_import_repo (M3).

Author: Damon Li
"""

from pathlib import Path

import pytest

from agenticx.skills.import_repo import _filter_skill_paths, import_skills_from_repo


def test_filter_skill_paths_excludes_deprecated() -> None:
    paths = [
        "skills/engineering/tdd/SKILL.md",
        "skills/deprecated/qa/SKILL.md",
        "skills/in-progress/foo/SKILL.md",
        "README.md",
    ]
    out = _filter_skill_paths(paths, "skills/**/SKILL.md", ["**/deprecated/**", "**/in-progress/**"])
    assert out == ["engineering/tdd"]


def test_import_dry_run_skips_network(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    def fake_tree(owner: str, name: str, branch: str):
        assert owner == "mattpocock"
        assert name == "skills"
        return ["skills/engineering/tdd/SKILL.md"]

    monkeypatch.setattr("agenticx.skills.import_repo._github_tree", fake_tree)
    result = import_skills_from_repo(repo="mattpocock/skills", dry_run=True)
    assert result.dry_run is True
    assert result.pending == ["engineering/tdd"]
    assert result.installed == []
