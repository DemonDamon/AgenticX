from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import _tool_skill_manage


@pytest.fixture
def skill_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    root = tmp_path / ".agenticx" / "skills"
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_rollback_to_previous_version(skill_home: Path) -> None:
    body = "---\nname: rb\n---\n\nV1\n"
    created = json.loads(_tool_skill_manage({"action": "create", "name": "rb", "content": body}, None))
    p = Path(created["path"])

    _tool_skill_manage(
        {
            "action": "patch",
            "name": "rb",
            "old_string": "V1",
            "new_string": "V2",
        },
        None,
    )
    assert "V2" in p.read_text(encoding="utf-8")

    history = json.loads(_tool_skill_manage({"action": "history", "name": "rb"}, None))
    assert history["ok"] is True
    assert history["versions"]
    target_version = history["versions"][0]["version"]

    rolled = json.loads(
        _tool_skill_manage(
            {"action": "rollback", "name": "rb", "to_version": target_version},
            None,
        )
    )
    assert rolled["ok"] is True
    assert "V1" in p.read_text(encoding="utf-8")
