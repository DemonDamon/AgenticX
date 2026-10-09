"""Regression: skill_manage must not crash on StudioSession in extra (_session)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.cli.agent_tools import (
    _skill_manage_success_payload,
    _tool_skill_manage,
    _write_skill_md_with_checks,
)
from agenticx.skills.frontmatter import _set_or_insert_frontmatter_field, ensure_skill_source


def _run(coro):
    return asyncio.run(coro)


class _FakeStudioSession:
    """Not JSON-serializable — mimics StudioSession in interactive skill_manage."""

    def __init__(self) -> None:
        self.session_id = "sess-test"
        self._session_id = "sess-test"
        self.workspace_roots = []

    def __repr__(self) -> str:
        return "StudioSession(fake)"


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
    return tmp_path


def test_success_payload_strips_underscore_keys() -> None:
    skill_md = Path("/tmp/fake/SKILL.md")
    session = _FakeStudioSession()
    raw = _skill_manage_success_payload(
        action="create",
        skill_md=skill_md,
        discoverable=True,
        skill_name="demo",
        frontmatter_fixed=["injected source: skillhub"],
        validation_warnings=[],
        extra={"_session": session, "source": "skillhub", "mode": "apply"},
    )
    payload = json.loads(raw)
    assert payload["ok"] is True
    assert payload["source"] == "skillhub"
    assert "_session" not in payload
    # Must not raise / must be round-trippable JSON
    json.dumps(payload)


def test_create_with_studio_session_serializes(skill_home: Path) -> None:
    body = "---\nname: sess-create\ndescription: demo\nsource: skillhub\n---\n\nHello.\n"
    session = _FakeStudioSession()
    out = _run(
        _tool_skill_manage(
            {"action": "create", "name": "sess-create", "content": body, "source": "skillhub"},
            session,  # type: ignore[arg-type]
        )
    )
    assert "crashed" not in out.lower()
    payload = json.loads(out)
    assert payload["ok"] is True
    assert "_session" not in payload
    assert Path(payload["path"]).is_file()
    # source=skillhub must land under registry/<slug>/ (Settings third-party bucket)
    assert "/registry/sess-create/" in payload["path"].replace("\\", "/") or payload["path"].replace("\\", "/").endswith("registry/sess-create/SKILL.md")
    text = Path(payload["path"]).read_text(encoding="utf-8")
    assert text.count("source:") == 1
    assert "source: skillhub" in text
    assert any("source" in x for x in payload.get("frontmatter_fixed", [])) or "skillhub" in text


def test_patch_with_studio_session_serializes(skill_home: Path) -> None:
    body = "---\nname: sess-patch\ndescription: demo\n---\n\nOLD_TOKEN\n"
    session = _FakeStudioSession()
    created = json.loads(
        _run(_tool_skill_manage({"action": "create", "name": "sess-patch", "content": body}, session))  # type: ignore[arg-type]
    )
    assert created["ok"] is True
    out = _run(
        _tool_skill_manage(
            {
                "action": "patch",
                "name": "sess-patch",
                "mode": "apply",
                "old_string": "OLD_TOKEN",
                "new_string": "NEW_TOKEN",
            },
            session,  # type: ignore[arg-type]
        )
    )
    assert "crashed" not in out.lower()
    payload = json.loads(out)
    assert payload["ok"] is True
    assert "_session" not in payload
    assert "NEW_TOKEN" in Path(payload["path"]).read_text(encoding="utf-8")


def test_view_returns_content_and_source(skill_home: Path) -> None:
    body = "---\nname: view-me\ndescription: demo\nsource: skillhub\n---\n\nBody.\n"
    _run(
        _tool_skill_manage(
            {"action": "create", "name": "view-me", "content": body, "source": "skillhub"},
            None,
        )
    )
    # Short name view must resolve registry/view-me after skillhub create rewrite.
    out = json.loads(_run(_tool_skill_manage({"action": "view", "name": "view-me"}, None)))
    assert out["ok"] is True
    assert "Body." in out["content"]
    assert "SKILL.md" in out["listing"]
    assert out["source"] in {"skillhub", "agent_created", "registry", "custom"}
    assert "registry" in str(out.get("name") or "") or "/registry/" in str(out.get("path") or "").replace("\\", "/")


def test_from_dir_copies_references(skill_home: Path) -> None:
    src = skill_home / ".agenticx" / "staging" / "import-skill"
    src.mkdir(parents=True)
    (src / "SKILL.md").write_text(
        "---\nname: bundled\ndescription: demo\n---\n\nMain.\n",
        encoding="utf-8",
    )
    ref = src / "references"
    ref.mkdir()
    (ref / "checklist.md").write_text("# checklist\n", encoding="utf-8")
    out = json.loads(
        _run(
            _tool_skill_manage(
                {
                    "action": "create",
                    "name": "registry/bundled",
                    "from_dir": str(src),
                    "source": "skillhub",
                },
                None,
            )
        )
    )
    assert out["ok"] is True
    skill_dir = Path(out["path"]).parent
    assert (skill_dir / "references" / "checklist.md").is_file()
    assert "copied_files" in out


def test_frontmatter_no_duplicate_source() -> None:
    fm = "name: x\nsource: skillhub\ndescription: d\nsource: agent_created\n"
    new_fm, changed = _set_or_insert_frontmatter_field(fm, "source", "skillhub")
    assert changed is True
    assert new_fm.count("source:") == 1
    assert "source: skillhub" in new_fm
    stamped = ensure_skill_source(
        "---\nname: x\ndescription: d\nsource: skillhub\n---\n\nBody.\n",
        "agent_created",
    )
    assert stamped.count("source:") == 1
    assert "source: agent_created" in stamped


def test_write_checks_strips_session_even_if_forced(skill_home: Path) -> None:
    skill_dir = skill_home / ".agenticx" / "skills" / "force-sess"
    skill_dir.mkdir(parents=True)
    body = "---\nname: force-sess\ndescription: demo\n---\n\nOk.\n"
    success, err = _write_skill_md_with_checks(
        action="create",
        skill_dir=skill_dir,
        content=body,
        canonical_name="force-sess",
        extra={"_session": _FakeStudioSession(), "note": "keep-me"},
        skip_queue=True,
        source="registry",
    )
    assert err is None
    payload = json.loads(success or "{}")
    assert payload["ok"] is True
    assert "_session" not in payload
    assert payload.get("note") == "keep-me"
    assert "source: registry" in (skill_dir / "SKILL.md").read_text(encoding="utf-8")


def test_patch_token_outdated_mentions_repreview(skill_home: Path) -> None:
    body = "---\nname: tok\ndescription: demo\n---\n\nAAA\n"
    _run(_tool_skill_manage({"action": "create", "name": "tok", "content": body}, None))
    preview = json.loads(
        _run(
            _tool_skill_manage(
                {
                    "action": "patch",
                    "name": "tok",
                    "mode": "preview",
                    "old_string": "AAA",
                    "new_string": "BBB",
                },
                None,
            )
        )
    )
    # Change file so content hash changes while old_string still matches
    p = skill_home / ".agenticx" / "skills" / "tok" / "SKILL.md"
    p.write_text(p.read_text(encoding="utf-8") + "\n# touched\n", encoding="utf-8")
    out = _run(
        _tool_skill_manage(
            {
                "action": "patch",
                "name": "tok",
                "mode": "apply",
                "old_string": "AAA",
                "new_string": "BBB",
                "patch_token": preview["patch_token"],
            },
            None,
        )
    )
    assert "outdated" in out.lower()
    assert "preview" in out.lower()


def test_skillhub_create_lands_under_registry(skill_home: Path) -> None:
    """Bare name + source=skillhub must write ~/.agenticx/skills/registry/<slug>/."""
    body = "---\nname: tiangong-skill\ndescription: demo\n---\n\nTiangong.\n"
    out = json.loads(
        _run(
            _tool_skill_manage(
                {
                    "action": "create",
                    "name": "tiangong-skill",
                    "content": body,
                    "source": "skillhub",
                },
                None,
            )
        )
    )
    assert out["ok"] is True
    path = Path(out["path"])
    assert path.is_file()
    parts = path.resolve().parts
    assert "registry" in parts
    assert parts[parts.index("registry") + 1] == "tiangong-skill"
    # Must NOT be only top-level skills/tiangong-skill
    top = skill_home / ".agenticx" / "skills" / "tiangong-skill" / "SKILL.md"
    assert not top.exists()
    assert "source: skillhub" in path.read_text(encoding="utf-8")
