#!/usr/bin/env python3
"""Project-local Markdown Plan artifacts for Studio sessions.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

from agenticx.utils.atomic_writer import atomic_write_text


TodoStatus = Literal["pending", "in_progress", "completed", "cancelled"]
PlanStatus = Literal["ready", "building", "completed", "cancelled"]

_TODO_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_MAX_TODOS = 20


class PlanArtifactTodo(BaseModel):
    id: str
    content: str
    status: TodoStatus = "pending"


class PlanArtifact(BaseModel):
    plan_id: str
    name: str
    overview: str
    status: PlanStatus = "ready"
    session_id: str
    created_at: str
    updated_at: str
    planned_with: str = ""
    todos: list[PlanArtifactTodo] = Field(default_factory=list)
    outcome: str | None = None
    body_markdown: str = ""
    path: str = ""
    source_metadata: dict[str, Any] = Field(default_factory=dict, exclude=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _writable_taskspace_paths(session: Any) -> list[tuple[str, Path]]:
    rows: list[tuple[str, Path]] = []
    for raw in getattr(session, "taskspaces", None) or []:
        if not isinstance(raw, dict):
            continue
        path = str(raw.get("path") or "").strip()
        if not path or str(raw.get("mount_mode") or "").strip().lower() == "reference":
            continue
        rows.append((str(raw.get("id") or "").strip(), Path(path).expanduser().resolve(strict=False)))
    if rows:
        return rows
    workspace = str(getattr(session, "workspace_dir", "") or "").strip()
    return [("default", Path(workspace).expanduser().resolve(strict=False))] if workspace else []


def _safe_plan_root(workspace_root: Path, *, create: bool) -> Path:
    workspace = workspace_root.resolve(strict=False)
    agenticx_dir = workspace / ".agenticx"
    plan_dir = agenticx_dir / "plans"
    for directory in (agenticx_dir, plan_dir):
        if directory.is_symlink():
            raise ValueError(f"Plan directory must not be a symlink: {directory}")
        if create:
            directory.mkdir(exist_ok=True)
        resolved = directory.resolve(strict=False)
        if not _is_relative_to(resolved, workspace):
            raise ValueError("Plan directory escapes the writable taskspace")
    return plan_dir.resolve(strict=False)


def _resolve_plan_root(session: Any, *, create: bool = False) -> Path:
    roots = _writable_taskspace_paths(session)
    if not roots:
        raise ValueError("No writable taskspace is available for this Plan")
    active_id = str(getattr(session, "active_taskspace_id", "") or "").strip()
    for taskspace_id, root in roots:
        if active_id and taskspace_id == active_id:
            return _safe_plan_root(root, create=create)
    for taskspace_id, root in roots:
        if taskspace_id == "default":
            return _safe_plan_root(root, create=create)
    return _safe_plan_root(roots[0][1], create=create)


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _validate_plan_path(session: Any, raw_path: str) -> Path:
    raw = Path(str(raw_path or "").strip()).expanduser()
    if ".." in raw.parts:
        raise ValueError("Plan path must not contain parent traversal")
    if raw.is_symlink():
        raise ValueError("Plan file must not be a symlink")
    path = raw.resolve(strict=False)
    if path.suffixes[-2:] != [".plan", ".md"]:
        raise ValueError("Plan path must end with .plan.md")
    root = _resolve_plan_root(session)
    if not _is_relative_to(path, root):
        raise ValueError("Plan path is outside the session plan roots")
    return path


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:48] or "plan"


def _normalize_todos(raw_todos: Any) -> list[PlanArtifactTodo]:
    if not isinstance(raw_todos, list) or not 2 <= len(raw_todos) <= _MAX_TODOS:
        raise ValueError(f"Plan todos must contain between 2 and {_MAX_TODOS} items")
    todos: list[PlanArtifactTodo] = []
    seen: set[str] = set()
    for raw in raw_todos:
        if not isinstance(raw, dict):
            raise ValueError("Each Plan todo must be an object")
        todo_id = str(raw.get("id") or "").strip()
        content = str(raw.get("content") or "").strip()
        if not _TODO_ID_RE.fullmatch(todo_id):
            raise ValueError(f"Invalid todo id: {todo_id or '<empty>'}")
        if todo_id in seen:
            raise ValueError(f"duplicate todo id: {todo_id}")
        if not content or len(content) > 300:
            raise ValueError(f"Todo {todo_id} content must contain 1-300 characters")
        seen.add(todo_id)
        todos.append(PlanArtifactTodo(id=todo_id, content=content))
    return todos


def _frontmatter_dict(plan: PlanArtifact) -> dict[str, Any]:
    data: dict[str, Any] = dict(plan.source_metadata)
    data.update(
        {
            "plan_id": plan.plan_id,
            "name": plan.name,
            "overview": plan.overview,
            "status": plan.status,
            "session_id": plan.session_id,
            "created_at": plan.created_at,
            "updated_at": plan.updated_at,
            "planned_with": plan.planned_with,
            "todos": [todo.model_dump() for todo in plan.todos],
        }
    )
    if plan.outcome:
        data["outcome"] = plan.outcome
    return data


def _render_plan_markdown(plan: PlanArtifact, body_markdown: str) -> str:
    frontmatter = yaml.safe_dump(
        _frontmatter_dict(plan),
        allow_unicode=True,
        sort_keys=False,
    ).strip()
    body = body_markdown.strip()
    relative_path = f".agenticx/plans/{Path(plan.path).name}"
    traceability = (
        "## Traceability\n\n"
        f"- Plan-Id: {plan.plan_id}\n"
        f"- Plan-File: {relative_path}\n"
    )
    return f"---\n{frontmatter}\n---\n\n{body}\n\n{traceability}"


def _artifact_payload(plan: PlanArtifact, *, action: str) -> str:
    return json.dumps(
        {
            "type": "plan_artifact",
            "action": action,
            "plan_id": plan.plan_id,
            "path": plan.path,
            "name": plan.name,
            "overview": plan.overview,
            "status": plan.status,
            "session_id": plan.session_id,
            "todos": [todo.model_dump() for todo in plan.todos],
            **({"outcome": plan.outcome} if plan.outcome else {}),
        },
        ensure_ascii=False,
    )


def create_plan_artifact(session: Any, arguments: dict[str, Any]) -> str:
    name = str(arguments.get("name") or "").strip()
    overview = str(arguments.get("overview") or "").strip()
    body = str(arguments.get("body_markdown") or "").strip()
    if not name or not overview or not body:
        raise ValueError("Plan name, overview, and body_markdown are required")
    todos = _normalize_todos(arguments.get("todos"))
    now = _now_iso()
    plan_id = f"{datetime.now(timezone.utc):%Y-%m-%d}-{_slugify(name)}-{uuid.uuid4().hex[:8]}"
    path = (_resolve_plan_root(session, create=True) / f"{plan_id}.plan.md").resolve(strict=False)
    provider = str(getattr(session, "provider_name", "") or "").strip()
    model = str(getattr(session, "model_name", "") or "").strip()
    planned_with = "/".join(part for part in (provider, model) if part)
    plan = PlanArtifact(
        plan_id=plan_id,
        name=name,
        overview=overview,
        session_id=str(getattr(session, "session_id", "") or "").strip(),
        created_at=now,
        updated_at=now,
        planned_with=planned_with,
        todos=todos,
        body_markdown=body,
        path=str(path),
    )
    atomic_write_text(path, _render_plan_markdown(plan, body))
    return _artifact_payload(plan, action="created")


def read_plan_artifact(raw_path: str) -> PlanArtifact:
    path = Path(raw_path).expanduser().resolve(strict=False)
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("Plan file is missing YAML frontmatter")
    parts = text.split("---\n", 2)
    if len(parts) != 3:
        raise ValueError("Plan frontmatter is malformed")
    metadata = yaml.safe_load(parts[1])
    if not isinstance(metadata, dict):
        raise ValueError("Plan frontmatter must be an object")
    body = parts[2].strip()
    traceability_index = body.rfind("\n## Traceability\n")
    if traceability_index >= 0:
        body = body[:traceability_index].strip()
    return PlanArtifact.model_validate(
        {
            **metadata,
            "body_markdown": body,
            "path": str(path),
            "source_metadata": metadata,
        }
    )


def update_plan_artifact(session: Any, arguments: dict[str, Any]) -> str:
    plan_id = str(arguments.get("plan_id") or "").strip()
    path = _validate_plan_path(session, str(arguments.get("plan_path") or ""))
    plan = read_plan_artifact(str(path))
    if plan.plan_id != plan_id:
        raise ValueError("plan_id does not match the Plan file")
    session_id = str(getattr(session, "session_id", "") or "").strip()
    if not session_id or plan.session_id != session_id:
        raise ValueError("Plan belongs to another session")

    action = str(arguments.get("action") or "").strip()
    if getattr(session, "plan_mode", False) and action in {"start", "set_todo"}:
        raise ValueError(
            "Plan lifecycle execution requires Build execution; "
            "Plan mode cannot start or advance implementation"
        )
    if action == "start":
        if plan.status not in {"completed", "cancelled"}:
            plan.status = "building"
    elif action == "cancel":
        plan.status = "cancelled"
        for todo in plan.todos:
            if todo.status in {"pending", "in_progress"}:
                todo.status = "cancelled"
    elif action == "set_todo":
        todo_id = str(arguments.get("todo_id") or "").strip()
        todo_status = str(arguments.get("todo_status") or "").strip()
        if todo_status not in {"pending", "in_progress", "completed", "cancelled"}:
            raise ValueError("todo_status is invalid")
        target = next((todo for todo in plan.todos if todo.id == todo_id), None)
        if target is None:
            raise ValueError(f"Unknown Plan todo: {todo_id}")
        if todo_status == "in_progress":
            for todo in plan.todos:
                if todo.id != todo_id and todo.status == "in_progress":
                    todo.status = "pending"
        target.status = todo_status  # type: ignore[assignment]
        active_todos = [todo for todo in plan.todos if todo.status != "cancelled"]
        if active_todos and all(todo.status == "completed" for todo in active_todos):
            plan.status = "completed"
        elif plan.status not in {"cancelled", "completed"}:
            plan.status = "building"
    else:
        raise ValueError("Plan action must be start, set_todo, or cancel")

    outcome = str(arguments.get("outcome") or "").strip()
    if outcome:
        plan.outcome = outcome
    plan.updated_at = _now_iso()
    atomic_write_text(path, _render_plan_markdown(plan, plan.body_markdown))
    return _artifact_payload(plan, action="updated")
