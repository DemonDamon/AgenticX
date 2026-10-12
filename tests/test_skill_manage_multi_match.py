from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import _tool_skill_manage


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def skill_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(
        "agenticx.learning.config.get_learning_config",
        lambda: {
            "agent_writes_require_approval": False,
            "freeze_during_session": False,
            "max_skill_bytes": 15360,
            "max_description_chars": 500,
        },
    )
    root = tmp_path / ".agenticx" / "skills"
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_patch_multi_match_requires_target_selection(skill_home: Path) -> None:
    body = "---\nname: mm\ndescription: demo\n---\n\nA\nX\nA\nX\n"
    created = json.loads(_run(_tool_skill_manage({"action": "create", "name": "mm", "content": body}, None)))
    p = Path(created["path"])

    preview = json.loads(
        _run(
            _tool_skill_manage(
                {
                    "action": "patch",
                    "name": "mm",
                    "mode": "preview",
                    "old_string": "A",
                    "new_string": "B",
                },
                None,
            )
        )
    )
    assert preview["ok"] is False
    assert preview["requires_target_selection"] is True
    assert preview["match_count"] == 2
    assert len(preview["target_ranges"]) == 2

    applied = json.loads(
        _run(
            _tool_skill_manage(
                {
                    "action": "patch",
                    "name": "mm",
                    "mode": "apply",
                    "old_string": "A",
                    "new_string": "B",
                    "target_index": 0,
                },
                None,
            )
        )
    )
    assert applied["ok"] is True
    text = p.read_text(encoding="utf-8")
    assert text.count("B") == 1
    assert text.count("A") == 1
