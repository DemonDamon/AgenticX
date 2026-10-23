#!/usr/bin/env python3
"""Precipitation hooks — delivery pipeline → case library.

T2: `on_stage_passed` forwards requirements/design stage artifacts into the
brain wiki compile queue (reusing the WikiCompileQueue enqueue contract).
T3: `compile_case_entry` turns a plan.mdc into a full case-entry, offline
(rule-based) by default, LLM-polished when a provider is injected.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.brain.wiki.page import slugify
from agenticx.cases.model import CASE_SCHEMA_VERSION, CaseEntry
from agenticx.cases.store import CaseStore
from agenticx.delivery.plan_mdc import DeliveryPlan

logger = logging.getLogger("agenticx.cases.precipitate")

# T2 only precipitates document-like stages; code/report stages are not
# wiki-compiled (task book: requirements/design 阶段产物).
PRECIPITATION_STAGES = ("requirements", "design")

SUMMARY_MAX_CHARS = 256

# Bound by the host process (CLI / studio) once a brain runtime exists.
_docs_rt: Any = None
_queue: Any = None


def bind_wiki_compiler(docs_rt: Any, queue: Any | None = None) -> None:
    """Register the brain runtime + wiki compile queue used by on_stage_passed.

    Without a binding on_stage_passed is a silent no-op — precipitation must
    never break the delivery pipeline.
    """
    global _docs_rt, _queue
    _docs_rt = docs_rt
    _queue = queue if queue is not None else getattr(docs_rt, "wiki_compiles", None)


def reset_wiki_compiler() -> None:
    """Drop the binding (test isolation)."""
    global _docs_rt, _queue
    _docs_rt = None
    _queue = None


def _plan_path(plan: DeliveryPlan) -> str:
    return str(Path(plan.worktree_path or ".") / "plan.mdc")


def stage_fingerprint(plan: DeliveryPlan, stage_id: str) -> str:
    """Dedup fingerprint: plan path + stage_id."""
    raw = f"{_plan_path(plan)}:{stage_id}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def on_stage_passed(stage_id: str, output_dir: Path, plan: DeliveryPlan) -> None:
    """T2: requirements/design artifacts → wiki compile queue (idempotent).

    Repeated calls for the same plan+stage never enqueue twice: the
    fingerprint marker is persisted under the stage output dir.
    """
    try:
        if stage_id not in PRECIPITATION_STAGES:
            return
        stage = next((s for s in plan.stages if s.id == stage_id), None)
        if stage is None:
            return

        output_dir = Path(output_dir)
        marker_dir = output_dir / ".case-precipitation"
        fingerprint = stage_fingerprint(plan, stage_id)
        marker = marker_dir / f"{fingerprint}.done"
        if marker.is_file():
            return

        if _queue is None or _docs_rt is None:
            # No brain runtime bound in this process — nothing to enqueue.
            return

        for artifact in stage.artifacts:
            if not str(artifact).endswith(".md"):
                continue
            doc_id = f"case-{plan.task_id}-{stage_id}-{slugify(Path(artifact).stem)}"
            try:
                _queue.enqueue(_docs_rt, doc_id, Path(artifact).name)
            except Exception as exc:  # queue contract mismatch must not break delivery
                logger.warning("case precipitation enqueue failed for %s: %s", doc_id, exc)

        marker_dir.mkdir(parents=True, exist_ok=True)
        marker.write_text(fingerprint, encoding="utf-8")
    except Exception:
        logger.exception("on_stage_passed crashed for stage=%s", stage_id)


def _rule_summary(plan: DeliveryPlan) -> str:
    parts: list[str] = []
    for stage in plan.stages:
        text = str(getattr(stage, "summary", "") or "").strip()
        if text:
            parts.append(f"{stage.label or stage.id}: {text}")
    if not parts:
        parts.append(f"{plan.project_name} 交付案例（{plan.target}）")
    return "；".join(parts)[:SUMMARY_MAX_CHARS]


def _llm_summary(llm: Any, plan: DeliveryPlan, fallback: str) -> str:
    prompt = (
        "请为以下交付项目写一段不超过 120 字的案例摘要（中文，一句话讲清做了什么、"
        "关键决策与结果），直接输出摘要正文：\n"
        f"项目: {plan.project_name}\n"
        f"目标形态: {plan.target}\n"
        f"整体状态: {plan.overall_status}\n"
    )
    try:
        resp = llm.invoke(prompt)
        content = str(getattr(resp, "content", "") or "").strip()
    except Exception as exc:
        logger.warning("LLM case summary failed, falling back to rule summary: %s", exc)
        return fallback
    return (content or fallback)[:SUMMARY_MAX_CHARS]


def compile_case_entry(plan: DeliveryPlan, *, store: CaseStore, llm: Any = None) -> CaseEntry:
    """T3: build a complete case-entry from plan.mdc (+ wiki pages).

    llm=None uses the rule-based path (summary = concatenation of stage
    summaries, truncated) — offline-safe, tests cost nothing.
    """
    rule_summary = _rule_summary(plan)
    summary = _llm_summary(llm, plan, rule_summary) if llm is not None else rule_summary

    intent = str(getattr(plan, "intent", "") or "").strip()
    problem = intent or f"{plan.project_name}（目标形态：{plan.target}）"

    solution_lines: list[str] = []
    artifacts: list[str] = []
    for stage in plan.stages:
        solution_lines.append(f"- {stage.label or stage.id}（{stage.status}）")
        for artifact in stage.artifacts:
            if artifact not in artifacts:
                artifacts.append(artifact)
    if plan.input_files:
        solution_lines.append("- 输入材料: " + ", ".join(plan.input_files))
    solution = "\n".join(solution_lines)

    completed = sum(1 for s in plan.stages if s.status == "completed")
    outcome = f"整体状态: {plan.overall_status}；阶段完成 {completed}/{len(plan.stages)}"

    scope: dict[str, str] = {str(k): str(v) for k, v in (dict(getattr(plan, "scope", None) or {})).items()}
    scope.setdefault("domain", "default")

    testing = next((s for s in plan.stages if s.id == "testing"), None)
    verification = {"eval_passed": "true" if testing and testing.status == "completed" else "false"}

    entry = CaseEntry(
        case_id=f"case-{plan.task_id}",
        title=plan.project_name or plan.task_id,
        type="case",
        summary=summary,
        problem=problem,
        solution=solution,
        outcome=outcome,
        artifacts=artifacts,
        scope=scope,
        lifecycle_status="active",
        supersedes=[],
        freshness=datetime.now(timezone.utc).date().isoformat(),
        provenance={
            "project_ref": plan.task_id,
            "trajectory_ref": plan.worktree_path,
            "compiler_version": f"agenticx-cases/{CASE_SCHEMA_VERSION}",
        },
        verification=verification,
    )
    store.save(entry)
    return entry
