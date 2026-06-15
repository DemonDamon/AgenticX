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


def test_patch_preview_then_apply_with_token(skill_home: Path) -> None:
    body = "---\nname: p1\n---\n\nOLD_VALUE\n"
    out = json.loads(_tool_skill_manage({"action": "create", "name": "p1", "content": body}, None))
    p = Path(out["path"])
    preview = json.loads(
        _tool_skill_manage(
            {
                "action": "patch",
                "name": "p1",
                "mode": "preview",
                "old_string": "OLD_VALUE",
                "new_string": "NEW_VALUE",
            },
            None,
        )
    )
    assert preview["ok"] is True
    assert preview["mode"] == "preview"
    assert isinstance(preview.get("patch_token"), str)
    assert "NEW_VALUE" not in p.read_text(encoding="utf-8")

    applied = json.loads(
        _tool_skill_manage(
            {
                "action": "patch",
                "name": "p1",
                "mode": "apply",
                "old_string": "OLD_VALUE",
                "new_string": "NEW_VALUE",
                "patch_token": preview["patch_token"],
            },
            None,
        )
    )
    assert applied["ok"] is True
    assert "NEW_VALUE" in p.read_text(encoding="utf-8")
