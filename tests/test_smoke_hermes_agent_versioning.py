#!/usr/bin/env python3
"""Smoke tests for skill versioning / changelog.

Validates hermes-agent proposal v2 §4.2.6.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.skills.versioning import (
    CHANGELOG_FILENAME,
    append_changelog,
    changelog_entry_count,
    read_changelog,
)


class TestAppendChangelog:
    def test_creates_file(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        append_changelog(skill_dir, action="create", summary="Initial version")
        cl = skill_dir / CHANGELOG_FILENAME
        assert cl.exists()
        text = cl.read_text()
        assert "## [" in text
        assert "create" in text
        assert "Initial version" in text

    def test_appends_multiple(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        append_changelog(skill_dir, action="create", summary="v1")
        append_changelog(skill_dir, action="patch", summary="fix typo")
        append_changelog(skill_dir, action="edit", summary="rewrite")
        assert changelog_entry_count(skill_dir) == 3

    def test_includes_session_id(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        append_changelog(skill_dir, action="patch", session_id="abc123", summary="fix")
        text = read_changelog(skill_dir)
        assert "abc123" in text

    def test_author_default(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        append_changelog(skill_dir, action="create")
        text = read_changelog(skill_dir)
        assert "agent" in text


class TestReadChangelog:
    def test_missing_file(self, tmp_path: Path) -> None:
        assert read_changelog(tmp_path / "no-such-skill") == ""

    def test_empty_file(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "empty-skill"
        skill_dir.mkdir()
        (skill_dir / CHANGELOG_FILENAME).write_text("")
        assert read_changelog(skill_dir) == ""


class TestEntryCount:
    def test_zero_when_missing(self, tmp_path: Path) -> None:
        assert changelog_entry_count(tmp_path / "nope") == 0

    def test_counts_headers(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "s"
        skill_dir.mkdir()
        for _ in range(5):
            append_changelog(skill_dir, action="patch")
        assert changelog_entry_count(skill_dir) == 5
