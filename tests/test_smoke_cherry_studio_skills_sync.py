"""Smoke tests for skills_sync helper."""

from __future__ import annotations

from pathlib import Path

from agenticx.tools.skill_sync import check_skills_sync, sync_skills


def _create_skill(base: Path, name: str, content: str) -> None:
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def test_sync_skills_full_copy(tmp_path: Path) -> None:
    source = tmp_path / ".agents" / "skills"
    target = tmp_path / ".claude" / "skills"
    _create_skill(source, "a", "A")
    _create_skill(source, "b", "B")
    _create_skill(source, "c", "C")

    result = sync_skills(source, target)

    assert sorted(result.synced) == ["a", "b", "c"]
    assert result.skipped == []
    assert result.errors == []
    assert (target / "a" / "SKILL.md").exists()


def test_sync_skills_incremental_skip_when_unchanged(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    _create_skill(source, "a", "A")
    sync_skills(source, target)

    result = sync_skills(source, target)
    assert result.synced == []
    assert result.skipped == ["a"]
    assert result.errors == []


def test_sync_skills_respects_public_filter(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    public_file = tmp_path / "public-skills.txt"
    _create_skill(source, "public-a", "A")
    _create_skill(source, "private-b", "B")
    public_file.write_text("public-a\n", encoding="utf-8")

    result = sync_skills(source, target, public_file)
    assert result.synced == ["public-a"]
    assert not (target / "private-b").exists()


def test_sync_skills_overwrites_different_target_content(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    _create_skill(source, "a", "new-content")
    _create_skill(target, "a", "old-content")

    result = sync_skills(source, target)
    assert result.synced == ["a"]
    assert (target / "a" / "SKILL.md").read_text(encoding="utf-8") == "new-content"


def test_check_skills_sync_detects_outdated(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    _create_skill(source, "a", "new-content")
    _create_skill(target, "a", "old-content")

    check = check_skills_sync(source, target)
    assert check.in_sync is False
    assert check.outdated == ["a"]


def test_missing_public_file_does_not_block_sync(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    _create_skill(source, "a", "A")
    missing = tmp_path / "missing-public-skills.txt"

    result = sync_skills(source, target, missing)
    assert result.synced == ["a"]
