#!/usr/bin/env python3
"""Read/write delivery task plan.mdc state files.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

STAGE_ORDER = ("requirements", "design", "development", "testing", "audit")
STAGE_LABELS = {
    "requirements": "需求拆解",
    "design": "UI/UX 设计",
    "development": "前端 POC 开发",
    "testing": "自动化测试",
    "audit": "审计验收",
}


@dataclass
class StageState:
    """Single pipeline stage snapshot."""

    id: str
    label: str
    status: str = "pending"
    retries: int = 0
    artifacts: list[str] = field(default_factory=list)
    blocker: str = ""
    avatar_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DeliveryPlan:
    """Parsed plan.mdc document."""

    task_id: str
    project_name: str
    target: str
    worktree_path: str
    output_dir: str
    current_stage: str = "requirements"
    overall_status: str = "pending"
    stages: list[StageState] = field(default_factory=list)
    input_files: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "project_name": self.project_name,
            "target": self.target,
            "worktree_path": self.worktree_path,
            "output_dir": self.output_dir,
            "current_stage": self.current_stage,
            "overall_status": self.overall_status,
            "input_files": list(self.input_files),
            "stages": [s.to_dict() for s in self.stages],
        }


def default_plan(
    *,
    task_id: str,
    project_name: str,
    target: str,
    worktree_path: str,
    output_dir: str,
    input_files: list[str],
) -> DeliveryPlan:
    stages = [
        StageState(
            id=sid,
            label=STAGE_LABELS[sid],
            avatar_id=_avatar_for_stage(sid),
        )
        for sid in STAGE_ORDER
    ]
    return DeliveryPlan(
        task_id=task_id,
        project_name=project_name,
        target=target,
        worktree_path=worktree_path,
        output_dir=output_dir,
        input_files=list(input_files),
        stages=stages,
    )


def _avatar_for_stage(stage_id: str) -> str:
    mapping = {
        "requirements": "delivery-analyst",
        "design": "delivery-designer",
        "development": "delivery-frontend",
        "testing": "delivery-qa",
        "audit": "delivery-qa",
    }
    return mapping.get(stage_id, "")


def write_plan(path: Path, plan: DeliveryPlan) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    front = {
        "task_id": plan.task_id,
        "project_name": plan.project_name,
        "target": plan.target,
        "worktree_path": plan.worktree_path,
        "output_dir": plan.output_dir,
        "current_stage": plan.current_stage,
        "overall_status": plan.overall_status,
        "input_files": plan.input_files,
    }
    lines = [
        "---",
        json.dumps(front, ensure_ascii=False, indent=2),
        "---",
        "",
        f"# Delivery Plan — {plan.project_name}",
        "",
        f"- Task ID: `{plan.task_id}`",
        f"- Target: **{plan.target}**",
        f"- Status: **{plan.overall_status}**",
        f"- Current stage: **{plan.current_stage}**",
        "",
        "## Stages",
        "",
    ]
    for stage in plan.stages:
        lines.append(f"### {stage.label} (`{stage.id}`)")
        lines.append(f"- Status: {stage.status}")
        lines.append(f"- Avatar: `{stage.avatar_id}`")
        lines.append(f"- Retries: {stage.retries}")
        if stage.blocker:
            lines.append(f"- Blocker: {stage.blocker}")
        if stage.artifacts:
            lines.append("- Artifacts:")
            for art in stage.artifacts:
                lines.append(f"  - `{art}`")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def read_plan(path: Path) -> DeliveryPlan | None:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return None
    try:
        meta = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(meta, dict):
        return None

    stages: list[StageState] = []
    for sid in STAGE_ORDER:
        block = _extract_stage_block(text, sid)
        stages.append(
            StageState(
                id=sid,
                label=STAGE_LABELS[sid],
                status=str(block.get("status") or "pending"),
                retries=int(block.get("retries") or 0),
                artifacts=list(block.get("artifacts") or []),
                blocker=str(block.get("blocker") or ""),
                avatar_id=_avatar_for_stage(sid),
            )
        )

    return DeliveryPlan(
        task_id=str(meta.get("task_id") or ""),
        project_name=str(meta.get("project_name") or ""),
        target=str(meta.get("target") or "POC"),
        worktree_path=str(meta.get("worktree_path") or ""),
        output_dir=str(meta.get("output_dir") or ""),
        current_stage=str(meta.get("current_stage") or "requirements"),
        overall_status=str(meta.get("overall_status") or "pending"),
        input_files=[str(x) for x in (meta.get("input_files") or [])],
        stages=stages,
    )


def _extract_stage_block(text: str, stage_id: str) -> dict[str, Any]:
    label = STAGE_LABELS.get(stage_id, stage_id)
    pattern = rf"### {re.escape(label)} \(`{re.escape(stage_id)}`\)(.*?)(?=\n### |\Z)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    out: dict[str, Any] = {}
    sm = re.search(r"- Status:\s*(\S+)", block)
    if sm:
        out["status"] = sm.group(1)
    rm = re.search(r"- Retries:\s*(\d+)", block)
    if rm:
        out["retries"] = int(rm.group(1))
    bm = re.search(r"- Blocker:\s*(.+)", block)
    if bm:
        out["blocker"] = bm.group(1).strip()
    arts = re.findall(r"  - `([^`]+)`", block)
    if arts:
        out["artifacts"] = arts
    return out


def update_stage(
    plan: DeliveryPlan,
    stage_id: str,
    *,
    status: str | None = None,
    artifacts: list[str] | None = None,
    blocker: str | None = None,
    increment_retry: bool = False,
) -> None:
    for stage in plan.stages:
        if stage.id != stage_id:
            continue
        if status is not None:
            stage.status = status
        if artifacts is not None:
            stage.artifacts = list(artifacts)
        if blocker is not None:
            stage.blocker = blocker
        if increment_retry:
            stage.retries += 1
        plan.current_stage = stage_id
        break
