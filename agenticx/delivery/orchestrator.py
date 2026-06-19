#!/usr/bin/env python3
"""Delivery task orchestrator — worktree sandbox + staged plan.mdc pipeline.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agenticx.delivery.bootstrap import ensure_delivery_bundle
from agenticx.delivery.config import get_delivery_config
from agenticx.delivery.plan_mdc import (
    STAGE_ORDER,
    default_plan,
    read_plan,
    update_stage,
    write_plan,
)
from agenticx.delivery.stages import materialize_stage_artifacts, next_stage, validate_stage_artifacts
from agenticx.delivery.store import (
    DeliveryTaskRecord,
    get_task,
    list_tasks,
    new_task_id,
    slugify,
    upsert_task,
)
from agenticx.delivery.worktree import WorktreeError, create_worktree, resolve_repo_root

logger = logging.getLogger("agenticx.delivery.orchestrator")

_running: dict[str, asyncio.Task[None]] = {}


@dataclass
class TaskSpec:
    """User-facing task creation payload."""

    project_name: str
    target: str = "POC"
    input_files: list[str] = field(default_factory=list)
    industry_template: str = ""


class DeliveryOrchestrator:
    """Thin orchestration layer over plan.mdc + worktree + stage runners."""

    def __init__(self) -> None:
        self.cfg = get_delivery_config()

    def is_enabled(self) -> bool:
        return bool(self.cfg.get("enabled", True))

    def list_tasks(self) -> list[dict[str, Any]]:
        return [t.to_dict() for t in list_tasks()]

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        record = get_task(task_id)
        if record is None:
            return None
        payload = record.to_dict()
        plan_path = Path(record.plan_path) if record.plan_path else None
        if plan_path and plan_path.is_file():
            plan = read_plan(plan_path)
            if plan is not None:
                payload["plan"] = plan.to_dict()
        return payload

    def start_delivery(self, spec: TaskSpec) -> dict[str, Any]:
        if not self.is_enabled():
            return {"ok": False, "error": "delivery subsystem disabled"}
        bootstrap = ensure_delivery_bundle()
        if not bootstrap.get("ok"):
            return {"ok": False, "error": bootstrap.get("error", "bootstrap failed")}

        name = str(spec.project_name or "").strip()
        if not name:
            return {"ok": False, "error": "project_name is required"}

        task_id = new_task_id()
        slug = slugify(name)
        worktree_root = Path(str(self.cfg.get("worktree_root") or "")).expanduser()
        worktree_path = worktree_root / slug
        branch = f"delivery/{slug}"

        try:
            repo_root = resolve_repo_root(str(self.cfg.get("repo_root") or ""))
            create_worktree(repo_root=repo_root, branch=branch, path=worktree_path)
        except WorktreeError as exc:
            return {"ok": False, "error": str(exc)}

        output_dir = worktree_path / "output" / task_id
        output_dir.mkdir(parents=True, exist_ok=True)
        _copy_inputs(spec.input_files, worktree_path / "input" / task_id)

        plan = default_plan(
            task_id=task_id,
            project_name=name,
            target=spec.target or "POC",
            worktree_path=str(worktree_path),
            output_dir=str(output_dir),
            input_files=list(spec.input_files),
        )
        plan_path = worktree_path / "plan.mdc"
        write_plan(plan_path, plan)

        record = DeliveryTaskRecord(
            task_id=task_id,
            project_name=name,
            target=spec.target or "POC",
            slug=slug,
            status="running",
            worktree_path=str(worktree_path),
            plan_path=str(plan_path),
            output_dir=str(output_dir),
            input_files=list(spec.input_files),
        )
        upsert_task(record)

        dry = bool(self.cfg.get("dry_run"))
        if dry:
            self._run_pipeline_sync(task_id)
        else:
            self._schedule_background(task_id)

        return {"ok": True, "task_id": task_id, "worktree_path": str(worktree_path)}

    def resume_delivery(self, task_id: str) -> dict[str, Any]:
        record = get_task(task_id)
        if record is None:
            return {"ok": False, "error": "task not found"}
        if record.status == "completed":
            return {"ok": True, "task_id": task_id, "status": "completed"}
        record.status = "running"
        upsert_task(record)
        self._schedule_background(task_id)
        return {"ok": True, "task_id": task_id, "status": "running"}

    def _schedule_background(self, task_id: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._run_pipeline_sync(task_id)
            return
        existing = _running.get(task_id)
        if existing is not None and not existing.done():
            return
        _running[task_id] = loop.create_task(self._run_pipeline_async(task_id))

    async def _run_pipeline_async(self, task_id: str) -> None:
        await asyncio.to_thread(self._run_pipeline_sync, task_id)

    def _run_pipeline_sync(self, task_id: str) -> None:
        record = get_task(task_id)
        if record is None:
            return
        plan_path = Path(record.plan_path)
        plan = read_plan(plan_path)
        if plan is None:
            return

        max_retries = int(self.cfg.get("max_stage_retries") or 2)
        dry = bool(self.cfg.get("dry_run"))
        output_dir = Path(record.output_dir)

        stage_index = 0
        while stage_index < len(STAGE_ORDER):
            stage_id = STAGE_ORDER[stage_index]
            stage = next(s for s in plan.stages if s.id == stage_id)
            if stage.status == "completed":
                stage_index += 1
                continue
            if stage.status == "awaiting_user":
                plan.overall_status = "awaiting_user"
                write_plan(plan_path, plan)
                record.status = "awaiting_user"
                upsert_task(record)
                return

            update_stage(plan, stage_id, status="running", blocker="")
            plan.overall_status = "running"
            write_plan(plan_path, plan)

            artifacts = materialize_stage_artifacts(
                stage_id,
                output_dir=output_dir,
                worktree_path=Path(record.worktree_path),
                project_name=record.project_name,
                input_files=record.input_files,
                dry_run=dry,
            )
            ok, reason = validate_stage_artifacts(stage_id, output_dir)
            stage = next(s for s in plan.stages if s.id == stage_id)
            if not ok:
                update_stage(plan, stage_id, status="failed", blocker=reason, increment_retry=True)
                stage = next(s for s in plan.stages if s.id == stage_id)
                if stage.retries >= max_retries:
                    update_stage(plan, stage_id, status="awaiting_user", blocker=reason)
                    plan.overall_status = "awaiting_user"
                    write_plan(plan_path, plan)
                    record.status = "awaiting_user"
                    upsert_task(record)
                    return
                write_plan(plan_path, plan)
                continue

            update_stage(plan, stage_id, status="completed", artifacts=artifacts, blocker="")
            nxt = next_stage(stage_id)
            plan.current_stage = nxt or stage_id
            write_plan(plan_path, plan)
            stage_index += 1

        plan.overall_status = "completed"
        plan.current_stage = STAGE_ORDER[-1]
        write_plan(plan_path, plan)
        record.status = "completed"
        upsert_task(record)


def _copy_inputs(paths: list[str], dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    for raw in paths:
        src = Path(str(raw)).expanduser()
        if not src.is_file():
            continue
        shutil.copy2(src, dest_dir / src.name)
