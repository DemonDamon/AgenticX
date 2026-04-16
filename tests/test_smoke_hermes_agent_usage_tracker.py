#!/usr/bin/env python3
"""Smoke tests for SkillUsageTracker — record, aggregate, deprecation.

Validates hermes-agent proposal v2 §4.2.3 / Phase 2.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.learning.skill_usage_tracker import (
    STATS_FILENAME,
    get_deprecation_candidates,
    get_stats,
    record_use,
)


class TestRecordUse:
    def test_creates_stats_file(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        record_use(skill_dir, session_id="s1", success=True, tool_calls_after=3)
        assert (skill_dir / STATS_FILENAME).exists()

    def test_appends_multiple(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        record_use(skill_dir, session_id="s1", success=True)
        record_use(skill_dir, session_id="s2", success=False)
        record_use(skill_dir, session_id="s3", success=None)
        stats = get_stats(skill_dir)
        assert stats.use_count == 3


class TestGetStats:
    def test_empty(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "empty-skill"
        skill_dir.mkdir()
        stats = get_stats(skill_dir)
        assert stats.use_count == 0
        assert stats.success_rate == 0.0

    def test_success_rate(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "rated-skill"
        skill_dir.mkdir()
        for _ in range(3):
            record_use(skill_dir, success=True)
        record_use(skill_dir, success=False)
        stats = get_stats(skill_dir)
        assert abs(stats.success_rate - 0.75) < 0.01

    def test_unknown_not_in_rate(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "unknown-skill"
        skill_dir.mkdir()
        record_use(skill_dir, success=True)
        record_use(skill_dir, success=None)
        stats = get_stats(skill_dir)
        assert stats.success_rate == 1.0
        assert stats.unknown_count == 1

    def test_avg_tool_calls_after(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "tool-skill"
        skill_dir.mkdir()
        record_use(skill_dir, tool_calls_after=10)
        record_use(skill_dir, tool_calls_after=20)
        stats = get_stats(skill_dir)
        assert stats.avg_tool_calls_after == 15.0

    def test_skill_name_from_dir(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "deploy-docker"
        skill_dir.mkdir()
        record_use(skill_dir, success=True)
        stats = get_stats(skill_dir)
        assert stats.skill_name == "deploy-docker"


class TestDeprecationCandidates:
    def test_no_candidates(self, tmp_path: Path) -> None:
        skill_dir = tmp_path / "good-skill"
        skill_dir.mkdir()
        for _ in range(10):
            record_use(skill_dir, success=True)
        assert get_deprecation_candidates(tmp_path) == []

    def test_flags_low_success(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad-skill"
        bad.mkdir()
        for _ in range(4):
            record_use(bad, success=False)
        record_use(bad, success=True)
        assert get_deprecation_candidates(tmp_path, min_uses=5) == ["bad-skill"]

    def test_below_min_uses_not_flagged(self, tmp_path: Path) -> None:
        bad = tmp_path / "new-skill"
        bad.mkdir()
        record_use(bad, success=False)
        record_use(bad, success=False)
        assert get_deprecation_candidates(tmp_path, min_uses=5) == []

    def test_multiple_candidates_sorted(self, tmp_path: Path) -> None:
        for name in ["z-skill", "a-skill"]:
            d = tmp_path / name
            d.mkdir()
            for _ in range(5):
                record_use(d, success=False)
        result = get_deprecation_candidates(tmp_path, min_uses=5)
        assert result == ["a-skill", "z-skill"]

    def test_empty_root(self, tmp_path: Path) -> None:
        assert get_deprecation_candidates(tmp_path / "nope") == []
