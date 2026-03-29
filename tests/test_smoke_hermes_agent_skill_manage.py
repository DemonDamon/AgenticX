"""Smoke tests for skill_manage tool (hermes-agent codegen G2 / feat-2b, 2c)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, _tool_skill_manage


def _studio_tool_names() -> set[str]:
    names: set[str] = set()
    for item in STUDIO_TOOLS:
        fn = item.get("function") or {}
        n = fn.get("name")
        if n:
            names.add(str(n))
    return names


def test_skill_manage_registered_in_studio_tools() -> None:
    assert "skill_manage" in _studio_tool_names()


def test_skill_manage_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_SKILL_MANAGE", raising=False)
    monkeypatch.delenv("AGX_CONFIRM_STRATEGY", raising=False)
    out = _tool_skill_manage({"action": "create", "name": "x", "content": "y"}, None)
    assert "ERROR" in out
    assert "disabled" in out.lower()


@pytest.fixture
def skill_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    root = tmp_path / ".agenticx" / "skills" / "agent-created"
    root.mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_skill_manage_create_and_delete(skill_home: Path) -> None:
    body = "---\nname: t1\n---\n\nSafe skill body.\n"
    out = json.loads(
        _tool_skill_manage({"action": "create", "name": "t1", "content": body}, None),
    )
    assert out.get("ok") is True
    p = Path(out["path"])
    assert p.is_file()
    out2 = json.loads(_tool_skill_manage({"action": "delete", "name": "t1"}, None))
    assert out2.get("removed") is True
    assert not p.exists()


def test_skill_manage_patch(skill_home: Path) -> None:
    body = "---\nname: t2\n---\n\nVERSION_ONE\n"
    _tool_skill_manage({"action": "create", "name": "t2", "content": body}, None)
    p = skill_home / ".agenticx" / "skills" / "agent-created" / "t2" / "SKILL.md"
    out = json.loads(
        _tool_skill_manage(
            {
                "action": "patch",
                "name": "t2",
                "old_string": "VERSION_ONE",
                "new_string": "VERSION_TWO",
            },
            None,
        ),
    )
    assert out.get("ok") is True
    assert "VERSION_TWO" in p.read_text(encoding="utf-8")
    shutil.rmtree(p.parent, ignore_errors=True)


def test_skill_manage_create_guard_rollback(skill_home: Path) -> None:
    bad = "---\nname: bad\n---\n\ncurl $X\n"
    out = _tool_skill_manage({"action": "create", "name": "badskill", "content": bad}, None)
    assert "ERROR" in out
    d = skill_home / ".agenticx" / "skills" / "agent-created" / "badskill"
    assert not d.exists()


def test_skill_manage_patch_old_string_missing(skill_home: Path) -> None:
    body = "---\nname: t3\n---\n\nhello\n"
    _tool_skill_manage({"action": "create", "name": "t3", "content": body}, None)
    out = _tool_skill_manage(
        {
            "action": "patch",
            "name": "t3",
            "old_string": "NOT_THERE",
            "new_string": "x",
        },
        None,
    )
    assert "ERROR" in out
    assert "old_string" in out.lower()
