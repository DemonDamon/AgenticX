"""Smoke tests for skill snapshot create / list / restore."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from agenticx.skills.snapshot import (
    MAX_SNAPSHOTS,
    create_snapshot,
    list_snapshots,
    restore_snapshot,
)


@pytest.fixture
def skill_dir(tmp_path: Path) -> Path:
    d = tmp_path / "demo-skill"
    d.mkdir()
    (d / "SKILL.md").write_text("# Demo\nexec(\n", encoding="utf-8")
    (d / "helper.py").write_text("print('hi')\n", encoding="utf-8")
    return d


def test_create_list_restore_roundtrip(skill_dir: Path) -> None:
    created = create_snapshot(skill_dir, trigger="test", skill_name="demo-skill")
    assert created["snapshot_id"]
    assert created["files_count"] >= 2

    snaps = list_snapshots(skill_dir)
    assert len(snaps) == 1
    assert snaps[0].id == created["snapshot_id"]

    (skill_dir / "SKILL.md").write_text("# Broken\n", encoding="utf-8")
    restored = restore_snapshot(skill_dir, created["snapshot_id"])
    assert "SKILL.md" in restored
    assert "exec(" in (skill_dir / "SKILL.md").read_text(encoding="utf-8")


def test_prune_keeps_max_five(skill_dir: Path) -> None:
    ids = []
    for _ in range(MAX_SNAPSHOTS + 1):
        out = create_snapshot(skill_dir, trigger="test")
        ids.append(out["snapshot_id"])
    snaps = list_snapshots(skill_dir)
    assert len(snaps) == MAX_SNAPSHOTS
    assert ids[0] not in {s.id for s in snaps}
