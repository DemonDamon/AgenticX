"""Tests for GEPA proposer (.proposals/ isolation)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.learning.gepa_proposer import proposals_root, write_proposal


@pytest.fixture
def proposals_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    root = tmp_path / ".agenticx" / "skills" / ".proposals"
    root.mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_write_proposal_creates_isolated_dir(proposals_home: Path) -> None:
    skill_md = "---\nname: demo-skill\ndescription: Demo\n---\n\nSteps here.\n"
    pdir = write_proposal(
        base_skill="demo-skill",
        action="create",
        skill_md_text=skill_md,
        session_id="sess-1",
        diff_summary="initial",
        candidate_index=1,
        total_candidates=1,
    )
    assert pdir.is_dir()
    assert (pdir / "SKILL.md").read_text(encoding="utf-8") == skill_md
    meta = json.loads((pdir / "proposal.json").read_text(encoding="utf-8"))
    assert meta["base_skill"] == "demo-skill"
    assert meta["status"] == "pending"
    main_skill = proposals_home / ".agenticx" / "skills" / "demo-skill"
    assert not main_skill.exists()


def test_proposals_root_is_under_dot_proposals(proposals_home: Path) -> None:
    root = proposals_root()
    assert root.name == ".proposals"
