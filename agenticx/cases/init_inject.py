#!/usr/bin/env python3
"""Init-time injection — assemble a new project from a case-entry (SP-D).

File copies + plan.mdc references only; no runtime hooks. Missing artifacts
are tolerated (recorded in the report) so a dirty case library never blocks
project bootstrap.

Author: Damon Li
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from agenticx.cases.model import CaseEntry
from agenticx.cases.store import CaseStore
from agenticx.delivery.plan_mdc import default_plan, write_plan

WIKI_PREFIX = "wiki/"
SKILLS_PREFIX = "skills/"


@dataclass
class InjectionResult:
    """Outcome of initializing a project from a case."""

    plan_path: Path            # generated initial plan.mdc
    wiki_pages: list[Path] = field(default_factory=list)  # wiki pages copied into the project
    skills: list[Path] = field(default_factory=list)      # copied skill files/dirs
    report: str = ""           # human-readable injection report


def _copy_artifact(
    rel: str,
    *,
    store: CaseStore,
    target_dir: Path,
) -> Path | None:
    """Copy one wiki/skills artifact (resolved against the store root).

    Returns the destination path, or None when the source is missing
    (tolerated — recorded by the caller, never raised).
    """
    src = store.root / rel
    if not src.exists():
        return None
    dest = target_dir / rel
    if src.is_dir():
        shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    return dest


def init_project_from_case(
    case: CaseEntry,
    *,
    target_dir: Path,
    store: CaseStore,
    intent: str = "",
) -> InjectionResult:
    """Bootstrap `target_dir` from a case-entry.

    Assembly:
    1. plan.mdc — default_plan() filled with intent (user-provided wins,
       fallback: case.summary → case.problem), scope from case.scope,
       case_refs=[case.case_id].
    2. case.artifacts with the wiki/ prefix are copied to target_dir/wiki/.
    3. case.artifacts with the skills/ prefix are copied to target_dir/skills/.
    4. Artifacts resolving to a missing path are skipped and recorded in the
       report (dirty data tolerated); other prefixes are not injected.

    Artifact paths are resolved against the store root (the case-library
    workspace that also hosts wiki/ and skills/ assets).
    """
    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    task_id = f"init-{case.case_id}"
    effective_intent = (
        (intent or "").strip() or case.summary.strip() or case.problem.strip()
    )

    plan = default_plan(
        task_id=task_id,
        project_name=case.title or case.case_id,
        target="POC",
        worktree_path=str(target_dir),
        output_dir=str(target_dir / "output" / task_id),
        input_files=[],
    )
    plan.intent = effective_intent
    plan.scope = dict(case.scope)
    plan.case_refs = [case.case_id]
    plan_path = target_dir / "plan.mdc"
    write_plan(plan_path, plan)

    wiki_pages: list[Path] = []
    skills: list[Path] = []
    missing: list[str] = []
    skipped: list[str] = []

    for artifact in case.artifacts:
        rel = str(artifact).strip()
        if not rel.startswith((WIKI_PREFIX, SKILLS_PREFIX)):
            skipped.append(rel)
            continue
        dest = _copy_artifact(rel, store=store, target_dir=target_dir)
        if dest is None:
            missing.append(rel)
        elif rel.startswith(WIKI_PREFIX):
            wiki_pages.append(dest)
        else:
            skills.append(dest)

    lines = [
        f"项目已初始化: {target_dir}",
        f"来源案例: {case.case_id}（{case.title}）",
        f"plan.mdc: {plan_path}",
        f"intent: {effective_intent or '(空)'}",
        f"wiki 页面: {len(wiki_pages)} 个",
    ]
    lines.extend(f"  - {path}" for path in wiki_pages)
    lines.append(f"skills: {len(skills)} 个")
    lines.extend(f"  - {path}" for path in skills)
    if missing:
        lines.append("缺失 artifact（已跳过，不影响初始化）:")
        lines.extend(f"  - {rel}" for rel in missing)
    if skipped:
        lines.append("非 wiki/skills 前缀 artifact（未注入）:")
        lines.extend(f"  - {rel}" for rel in skipped)

    return InjectionResult(
        plan_path=plan_path,
        wiki_pages=wiki_pages,
        skills=skills,
        report="\n".join(lines),
    )
