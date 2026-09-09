#!/usr/bin/env python3
"""Durable project-local Plan artifact lifecycle tests.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool_async
from agenticx.runtime import plan_artifacts


def _session(
    workspace: Path,
    *,
    active_taskspace_id: str = "default",
    taskspaces: list[dict[str, str]] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        session_id="session-plan-1",
        workspace_dir=str(workspace),
        active_taskspace_id=active_taskspace_id,
        taskspaces=taskspaces
        or [
            {
                "id": "default",
                "label": "默认工作区",
                "path": str(workspace),
                "mount_mode": "link",
            }
        ],
        provider_name="openai",
        model_name="gpt-test",
    )


def _create_args() -> dict:
    return {
        "name": "Durable Plan",
        "overview": "Persist the implementation plan.",
        "todos": [
            {"id": "backend", "content": "Implement the backend"},
            {"id": "desktop", "content": "Implement the desktop card"},
        ],
        "body_markdown": "# Durable Plan\n\n## Implementation\n\nDetailed steps.\n",
    }


def _payload(raw: str) -> dict:
    parsed = json.loads(raw)
    assert parsed["type"] == "plan_artifact"
    return parsed


def _frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    return yaml.safe_load(text.split("---\n", 2)[1])


def test_create_plan_artifact_in_project_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()

    payload = _payload(plan_artifacts.create_plan_artifact(_session(workspace), _create_args()))
    path = Path(payload["path"])

    assert path.parent == (workspace / ".agenticx" / "plans").resolve()
    assert path.name.endswith(".plan.md")
    assert payload["status"] == "ready"
    assert [todo["status"] for todo in payload["todos"]] == ["pending", "pending"]
    metadata = _frontmatter(path)
    assert metadata["plan_id"] == payload["plan_id"]
    assert metadata["session_id"] == "session-plan-1"
    assert metadata["planned_with"] == "openai/gpt-test"
    assert "Detailed steps." in path.read_text(encoding="utf-8")
    assert f"- Plan-Id: {payload['plan_id']}" in path.read_text(encoding="utf-8")
    assert f"- Plan-File: .agenticx/plans/{path.name}" in path.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_plan_create_is_registered_and_dispatchable_in_plan_mode(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    session = _session(workspace)
    session.plan_mode = True
    names = {
        str((tool.get("function") or {}).get("name") or "")
        for tool in STUDIO_TOOLS
        if isinstance(tool, dict)
    }

    assert {"plan_create", "plan_update"}.issubset(names)
    result = await dispatch_tool_async("plan_create", _create_args(), session)
    assert _payload(result)["status"] == "ready"


def test_active_writable_taskspace_wins_over_default(tmp_path: Path) -> None:
    default = tmp_path / "default"
    active = tmp_path / "active"
    default.mkdir()
    active.mkdir()
    session = _session(
        default,
        active_taskspace_id="work",
        taskspaces=[
            {"id": "default", "path": str(default), "mount_mode": "link"},
            {"id": "work", "path": str(active), "mount_mode": "link"},
        ],
    )

    payload = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))

    assert Path(payload["path"]).is_relative_to(active.resolve())


def test_reference_taskspace_is_not_used_as_plan_root(tmp_path: Path) -> None:
    default = tmp_path / "default"
    reference = tmp_path / "reference"
    default.mkdir()
    reference.mkdir()
    session = _session(
        default,
        active_taskspace_id="reference",
        taskspaces=[
            {"id": "default", "path": str(default), "mount_mode": "link"},
            {"id": "reference", "path": str(reference), "mount_mode": "reference"},
        ],
    )

    payload = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))

    assert Path(payload["path"]).is_relative_to(default.resolve())
    assert not (reference / ".agenticx").exists()


def test_duplicate_todo_ids_are_rejected_without_writing(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    args = _create_args()
    args["todos"][1]["id"] = "backend"

    with pytest.raises(ValueError, match="duplicate todo id"):
        plan_artifacts.create_plan_artifact(_session(workspace), args)

    assert not (workspace / ".agenticx").exists()


def test_update_rejects_path_outside_project_plan_root(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    outside = tmp_path / "outside.plan.md"
    workspace.mkdir()
    outside.write_text("---\nplan_id: nope\n---\n", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the session plan roots"):
        plan_artifacts.update_plan_artifact(
            _session(workspace),
            {
                "plan_id": "nope",
                "plan_path": str(outside),
                "action": "start",
            },
        )


def test_create_rejects_symlinked_plan_directory(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / ".agenticx").mkdir()
    (workspace / ".agenticx" / "plans").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        plan_artifacts.create_plan_artifact(_session(workspace), _create_args())

    assert list(outside.iterdir()) == []


def test_update_rejects_plan_owned_by_another_session(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    owner = _session(workspace)
    created = _payload(plan_artifacts.create_plan_artifact(owner, _create_args()))
    other = _session(workspace)
    other.session_id = "session-plan-2"

    with pytest.raises(ValueError, match="belongs to another session"):
        plan_artifacts.update_plan_artifact(
            other,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "start",
            },
        )


def test_plan_mode_cannot_start_build_lifecycle(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    session = _session(workspace)
    created = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))
    session.plan_mode = True

    with pytest.raises(ValueError, match="Build execution"):
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "start",
            },
        )

    persisted = plan_artifacts.read_plan_artifact(created["path"])
    assert persisted.status == "ready"
    assert all(todo.status == "pending" for todo in persisted.todos)


def test_update_preserves_unknown_frontmatter_fields(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    session = _session(workspace)
    created = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))
    path = Path(created["path"])
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("name: Durable Plan\n", "name: Durable Plan\ncustom_key: keep-me\n"), encoding="utf-8")

    plan_artifacts.update_plan_artifact(
        session,
        {
            "plan_id": created["plan_id"],
            "plan_path": created["path"],
            "action": "start",
        },
    )

    assert _frontmatter(path)["custom_key"] == "keep-me"


def test_update_validates_plan_id_and_advances_todos(tmp_path: Path) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    session = _session(workspace)
    created = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))

    with pytest.raises(ValueError, match="plan_id does not match"):
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": "wrong-plan",
                "plan_path": created["path"],
                "action": "start",
            },
        )

    started = _payload(
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "start",
            },
        )
    )
    assert started["status"] == "building"

    first = _payload(
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "set_todo",
                "todo_id": "backend",
                "todo_status": "in_progress",
            },
        )
    )
    assert first["todos"][0]["status"] == "in_progress"

    second = _payload(
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "set_todo",
                "todo_id": "desktop",
                "todo_status": "in_progress",
            },
        )
    )
    assert second["todos"][0]["status"] == "pending"
    assert second["todos"][1]["status"] == "in_progress"

    for todo_id in ("backend", "desktop"):
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "set_todo",
                "todo_id": todo_id,
                "todo_status": "completed",
            },
        )
    completed = plan_artifacts.read_plan_artifact(created["path"])
    assert completed.status == "completed"
    assert all(todo.status == "completed" for todo in completed.todos)


def test_atomic_write_failure_preserves_existing_plan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "project"
    workspace.mkdir()
    session = _session(workspace)
    created = _payload(plan_artifacts.create_plan_artifact(session, _create_args()))
    path = Path(created["path"])
    before = path.read_text(encoding="utf-8")

    def _fail(*_args, **_kwargs) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(plan_artifacts, "atomic_write_text", _fail)
    with pytest.raises(OSError, match="disk full"):
        plan_artifacts.update_plan_artifact(
            session,
            {
                "plan_id": created["plan_id"],
                "plan_path": created["path"],
                "action": "start",
            },
        )

    assert path.read_text(encoding="utf-8") == before
