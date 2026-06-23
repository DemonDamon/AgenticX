"""Tests for skill write freeze during active agent runs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import _tool_skill_manage
from agenticx.runtime.session_freeze import inc_active, reset_active_count_for_tests


@pytest.fixture
def skill_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(
        "agenticx.learning.config.get_learning_config",
        lambda: {
            "agent_writes_require_approval": False,
            "freeze_during_session": True,
            "max_skill_bytes": 15360,
            "max_description_chars": 500,
        },
    )
    reset_active_count_for_tests()
    return tmp_path


def test_freeze_queues_create_while_active(skill_home: Path) -> None:
    inc_active()
    try:
        body = "---\nname: frozen-skill\ndescription: Frozen\n---\n\nSteps.\n"
        out = json.loads(_tool_skill_manage({"action": "create", "name": "frozen-skill", "content": body}, None))
        assert out.get("action") == "create_pending"
        assert not (skill_home / ".agenticx" / "skills" / "frozen-skill" / "SKILL.md").exists()
        proposal_root = skill_home / ".agenticx" / "skills" / ".proposals"
        assert any(proposal_root.iterdir())
    finally:
        reset_active_count_for_tests()
