"""Tests for pending skill proposal queue."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datetime import datetime, timezone
from types import SimpleNamespace

from agenticx.cli.agent_tools import _queue_skill_proposal
from agenticx.skills.pending_queue import approve, list_pending, reject
from agenticx.skills.versioning import read_changelog


@pytest.fixture
def skills_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    proposals = tmp_path / ".agenticx" / "skills" / ".proposals" / "abc123"
    proposals.mkdir(parents=True)
    skill_md = "---\nname: queued-skill\ndescription: Queued\n---\n\nDo the thing.\n"
    (proposals / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (proposals / "proposal.json").write_text(
        json.dumps(
            {
                "proposal_id": "abc123",
                "base_skill": "queued-skill",
                "action": "create",
                "author_session_id": "",
                "author_model": "",
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "candidate_index": 1,
                "total_candidates": 1,
                "diff_summary": "test",
                "scores": None,
                "status": "pending",
            }
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_list_pending_returns_proposal(skills_home: Path) -> None:
    rows = list_pending()
    assert len(rows) == 1
    assert rows[0]["proposal_id"] == "abc123"


def test_approve_merges_and_writes_changelog(skills_home: Path) -> None:
    result = approve("abc123", approver="test-user")
    assert result["ok"] is True
    skill_dir = skills_home / ".agenticx" / "skills" / "queued-skill"
    assert (skill_dir / "SKILL.md").is_file()
    changelog = read_changelog(skill_dir)
    assert "approved" in changelog
    assert list_pending() == []


def test_reject_removes_proposal(skills_home: Path) -> None:
    result = reject("abc123", reason="not needed")
    assert result["ok"] is True
    assert list_pending() == []


def test_queue_proposal_reads_underscore_session_id(skills_home: Path) -> None:
    session = SimpleNamespace(
        _session_id="33a3bc2a-d494-493f-a62a-e29a3b4f027d",
        model_name="glm-5.2",
    )
    raw = _queue_skill_proposal(
        action="create",
        name="from-session",
        skill_md_text="---\nname: from-session\ndescription: Queued\n---\n\nBody.\n",
        session=session,
    )
    data = json.loads(raw)
    meta = json.loads(
        (
            skills_home
            / ".agenticx"
            / "skills"
            / ".proposals"
            / data["proposal_id"]
            / "proposal.json"
        ).read_text(encoding="utf-8")
    )
    assert meta["author_session_id"] == "33a3bc2a-d494-493f-a62a-e29a3b4f027d"
    assert meta["author_model"] == "glm-5.2"


def test_approve_eval_set_is_not_blocked(skills_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SKILL_GUARD_VERSION", "2")
    pdir = skills_home / ".agenticx" / "skills" / ".proposals" / "abc123"
    (pdir / "SKILL.md").write_text(
        "---\nname: queued-skill\ndescription: Review an eval set\n---\n\n"
        "Use eval set and Evals to decide what to keep.\n",
        encoding="utf-8",
    )
    result = approve("abc123", approver="test-user")
    assert result["ok"] is True


def test_approve_guard_block_is_chinese(skills_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SKILL_GUARD_VERSION", "2")
    pdir = skills_home / ".agenticx" / "skills" / ".proposals" / "abc123"
    (pdir / "SKILL.md").write_text(
        "---\nname: queued-skill\ndescription: Queued\n---\n\n"
        'Run eval "$PAYLOAD" against the host.\n',
        encoding="utf-8",
    )
    result = approve("abc123", approver="test-user")
    assert result["ok"] is False
    err = str(result.get("error") or "")
    assert "blocked:" not in err
    assert "没能写入" in err
    assert "可以改写" in err or "拒绝" in err


def test_approve_create_when_orphan_dir_without_skill_md(skills_home: Path) -> None:
    """Orphan skill dirs (e.g. failed guard rollback) must not block create approval."""
    skill_dir = skills_home / ".agenticx" / "skills" / "queued-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / ".changelog").write_text("orphan\n", encoding="utf-8")

    result = approve("abc123", approver="test-user")
    assert result["ok"] is True
    assert (skill_dir / "SKILL.md").is_file()
    assert list_pending() == []
