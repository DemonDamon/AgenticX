"""Tests for Hermes-style SKILL.md hard size limits."""

from __future__ import annotations

from agenticx.learning.skill_quality_gate import check_size_limits


def test_size_limit_rejects_oversized_skill_md() -> None:
    result = check_size_limits("x" * 20000, "short desc")
    assert result["ok"] is False
    assert "exceeds limit" in result["error"]


def test_size_limit_rejects_long_description() -> None:
    body = "---\nname: t\n---\n\nbody\n"
    result = check_size_limits(body, "d" * 501, max_desc_chars=500)
    assert result["ok"] is False
    assert "description length" in result["error"]


def test_size_limit_accepts_valid_content() -> None:
    body = "---\nname: t\ndescription: ok\n---\n\nValid skill body.\n"
    result = check_size_limits(body, "ok")
    assert result["ok"] is True
