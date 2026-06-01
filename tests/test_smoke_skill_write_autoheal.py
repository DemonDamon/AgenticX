"""Smoke tests for file_write/file_edit SKILL.md auto-heal discoverability.

Plan-Id: 2026-06-01-skill-write-autoheal-discoverability
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.cli.agent_tools import _autoheal_skill_md_after_write


def _write(skill_dir: Path, body: str) -> Path:
    skill_dir.mkdir(parents=True, exist_ok=True)
    p = skill_dir / "SKILL.md"
    p.write_text(body, encoding="utf-8")
    return p


def test_title_only_skill_md_is_autohealed(tmp_path: Path) -> None:
    """AC-1: title-only SKILL.md gets name injected and becomes discoverable."""
    skill_dir = tmp_path / ".agenticx" / "skills" / "a-stock-daily-report"
    body = (
        "---\n"
        "title: A股大盘指数数据采集与日报生成\n"
        "version: 1.0.0\n"
        "description: 采集A股7大主要指数的收盘价量数据并生成市场日报\n"
        "---\n\n"
        "# Body\n"
    )
    p = _write(skill_dir, body)
    out = _autoheal_skill_md_after_write(p, f"OK: wrote {p}")
    assert "已可在设置 → Skills 检索" in out
    text = p.read_text(encoding="utf-8")
    assert "name: a-stock-daily-report" in text


def test_no_frontmatter_skill_md_reports_error(tmp_path: Path) -> None:
    """AC-2: SKILL.md without frontmatter returns an explicit non-discoverable error."""
    skill_dir = tmp_path / ".agenticx" / "skills" / "no-fm"
    p = _write(skill_dir, "# no frontmatter here\n")
    out = _autoheal_skill_md_after_write(p, f"OK: wrote {p}")
    assert out.startswith("ERROR")
    assert "不会被收录" in out or "不可被检索" in out


def test_non_skill_file_unchanged(tmp_path: Path) -> None:
    """AC-3: ordinary file writes pass through untouched."""
    p = tmp_path / "report.md"
    p.write_text("# hello\n", encoding="utf-8")
    base = f"OK: wrote {p}"
    assert _autoheal_skill_md_after_write(p, base) == base


def test_skill_md_directly_under_skills_is_ignored(tmp_path: Path) -> None:
    """SKILL.md directly under skills/ (no skill dir) is not treated as a skill."""
    skills_root = tmp_path / "skills"
    p = _write(skills_root, "---\ntitle: x\n---\n")
    base = f"OK: wrote {p}"
    assert _autoheal_skill_md_after_write(p, base) == base


def test_already_valid_skill_is_idempotent(tmp_path: Path) -> None:
    """A SKILL.md that already has a matching name is reported discoverable without rewrite churn."""
    skill_dir = tmp_path / ".agenticx" / "skills" / "good-skill"
    body = "---\nname: good-skill\ndescription: a valid skill\n---\n\n# Body\n"
    p = _write(skill_dir, body)
    before = p.read_text(encoding="utf-8")
    out = _autoheal_skill_md_after_write(p, f"OK: wrote {p}")
    assert "已可在设置 → Skills 检索" in out
    assert p.read_text(encoding="utf-8") == before


def test_mismatched_name_is_aligned_to_dir(tmp_path: Path) -> None:
    """A SKILL.md whose name differs from its directory is realigned to the dir name."""
    skill_dir = tmp_path / ".agenticx" / "skills" / "right-name"
    body = "---\nname: wrong-name\ndescription: test\n---\n\n# Body\n"
    p = _write(skill_dir, body)
    out = _autoheal_skill_md_after_write(p, f"OK: wrote {p}")
    assert "已可在设置 → Skills 检索" in out
    assert "name: right-name" in p.read_text(encoding="utf-8")
