#!/usr/bin/env python3
"""Stage artifact materialization for delivery dry-run and validation.

Author: Damon Li
"""

from __future__ import annotations

import logging
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from agenticx.delivery.plan_mdc import STAGE_ORDER

if TYPE_CHECKING:
    # 运行时零 import（stage_agents 反向依赖本模块的 GateVerdict），仅作类型标注。
    from agenticx.delivery.stage_agents import StageAgent

logger = logging.getLogger("agenticx.delivery.stages")

# 走 StageAgent 的阶段（SP-B 范围）；其余阶段保持 stub 模板。
_AGENT_STAGES = ("requirements", "design")


def materialize_stage_artifacts(
    stage_id: str,
    *,
    output_dir: Path,
    worktree_path: Path,
    project_name: str,
    input_files: list[str],
    dry_run: bool = True,
    stage_agent: "StageAgent | None" = None,
    intent: str = "",
) -> list[str]:
    """Create expected stage outputs (stub in dry-run, scaffold in live bootstrap).

    SP-B: requirements/design 且提供 stage_agent（且非 dry-run）时走 LLM Agent
    生成；Agent 运行失败优雅降级回 stub。其余情况走下方模板逻辑（逐字节不变）。
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    rel_paths: list[str] = []

    def rel(p: Path) -> str:
        return str(p.relative_to(worktree_path))

    if stage_agent is not None and not dry_run and stage_id in _AGENT_STAGES:
        try:
            result = stage_agent.run(
                intent=intent or project_name,
                input_files=list(input_files),
                output_dir=output_dir,
            )
        except Exception:
            logger.warning(
                "stage agent failed for %s; falling back to stub template", stage_id, exc_info=True
            )
        else:
            for art in result.artifacts:
                p = Path(art)
                if not p.is_absolute():
                    p = output_dir / p
                try:
                    rel_paths.append(rel(p))
                except ValueError:
                    rel_paths.append(str(p))
            return rel_paths

    if stage_id == "requirements":
        path = output_dir / "requirement-breakdown.md"
        inputs = "\n".join(f"- {p}" for p in input_files) or "- (no input files)"
        path.write_text(
            textwrap.dedent(
                f"""\
                # Requirement Breakdown — {project_name}

                ## Source materials
                {inputs}

                ## Functional pages
                1. Dashboard overview
                2. Task list with filters
                3. Settings panel

                ## Acceptance criteria
                - [ ] All primary navigation routes render without error
                - [ ] Forms validate required fields
                - [ ] Theme tokens match enterprise indigo/violet baseline
                """
            ),
            encoding="utf-8",
        )
        rel_paths.append(rel(path))

    elif stage_id == "design":
        design_dir = output_dir / "design"
        design_dir.mkdir(parents=True, exist_ok=True)
        ds = design_dir / "design-system.md"
        ds.write_text(
            textwrap.dedent(
                """\
                # Design System (POC)

                - Primary: indigo/violet OKLCH tokens
                - Layout: AppShell + grouped sidebar + content canvas
                - Density: comfortable B2B spacing (8px grid)
                - References: IBM Carbon, Arco Design (patterns only)
                """
            ),
            encoding="utf-8",
        )
        svg = design_dir / "dashboard-wireframe.svg"
        svg.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480">'
            '<rect width="800" height="480" fill="#f4f4f8"/>'
            '<rect x="0" y="0" width="200" height="480" fill="#312e81"/>'
            '<text x="240" y="48" font-size="20" fill="#1e1b4b">Dashboard POC</text>'
            "</svg>",
            encoding="utf-8",
        )
        rel_paths.extend(
            [
                rel(ds),
                rel(svg),
            ]
        )

    elif stage_id == "development":
        fe = output_dir / "frontend"
        fe.mkdir(parents=True, exist_ok=True)
        pkg = fe / "package.json"
        pkg.write_text(
            '{\n  "name": "delivery-poc",\n  "private": true,\n'
            '  "scripts": { "dev": "vite", "build": "vite build" }\n}\n',
            encoding="utf-8",
        )
        readme = fe / "README.md"
        readme.write_text("# Delivery POC frontend\n\nRun `pnpm install && pnpm dev`.\n", encoding="utf-8")
        rel_paths.extend(
            [
                rel(pkg),
                rel(readme),
            ]
        )

    elif stage_id == "testing":
        qa = output_dir / "qa" / "playwright-report"
        qa.mkdir(parents=True, exist_ok=True)
        index = qa / "index.html"
        index.write_text("<html><body><h1>Playwright Report (stub)</h1></body></html>", encoding="utf-8")
        for i in range(1, 6):
            shot = qa / f"screenshot-{i}.png"
            shot.write_bytes(b"\x89PNG\r\n\x1a\n")
        rel_paths.append(rel(qa))

    elif stage_id == "audit":
        summary = output_dir / "delivery-summary.md"
        summary.write_text(
            textwrap.dedent(
                f"""\
                # Delivery Summary — {project_name}

                ## Artifacts
                - requirement-breakdown.md
                - design/design-system.md
                - frontend/README.md
                - qa/playwright-report/

                ## Gaps
                - Live Figma link requires FIGMA_API_KEY
                - Full Playwright suite requires @playwright/mcp browser install
                """
            ),
            encoding="utf-8",
        )
        rel_paths.append(rel(summary))

    return rel_paths


def validate_stage_artifacts(stage_id: str, output_dir: Path) -> tuple[bool, str]:
    """Lightweight filesystem validation per stage."""
    checks = {
        "requirements": ["requirement-breakdown.md"],
        "design": ["design/design-system.md"],
        "development": ["frontend/README.md"],
        "testing": ["qa/playwright-report/index.html"],
        "audit": ["delivery-summary.md"],
    }
    missing = [name for name in checks.get(stage_id, []) if not (output_dir / name).exists()]
    if missing:
        return False, f"missing artifacts: {', '.join(missing)}"
    if stage_id == "testing":
        shots = list((output_dir / "qa" / "playwright-report").glob("screenshot-*.png"))
        if len(shots) < 5:
            return False, "expected at least 5 playwright screenshots"
    return True, ""


@dataclass
class GateVerdict:
    """Structured verdict for the two-level stage gate (Plan DSL v1).

    ``failures`` entries must each point at a concrete ``gate_criteria`` item;
    ``suggestions`` must be rebuttable (which spec is uncovered / which test
    case is missing).
    """

    passed: bool
    stage_id: str
    fast_path: bool  # True = filesystem check only; False = LLM review
    failures: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


def validate_stage_with_gate(
    stage_id: str,
    output_dir: Path,
    *,
    gate_criteria: list[str] | None = None,
    llm_judge: Callable[[str, list[str], Path], GateVerdict] | None = None,
) -> GateVerdict:
    """Two-level stage validation (Plan DSL v1 gate contract).

    1. fast path: filesystem existence check via the existing
       ``validate_stage_artifacts``; on failure return immediately without
       invoking the LLM judge.
    2. LLM path: when ``gate_criteria`` is non-empty AND ``llm_judge`` is
       provided, call ``llm_judge(stage_id, criteria, output_dir)`` and enforce
       the verdict contract (``fast_path=False``; a failed verdict must carry
       structured failure reasons, otherwise it gets flagged).
    With ``llm_judge=None`` the call degrades to a pure fast path (compatible
    with existing callers and tests).
    """
    ok, reason = validate_stage_artifacts(stage_id, output_dir)
    if not ok:
        return GateVerdict(
            passed=False,
            stage_id=stage_id,
            fast_path=True,
            failures=[reason],
            suggestions=[],
        )
    criteria = list(gate_criteria or [])
    if criteria and llm_judge is not None:
        verdict = llm_judge(stage_id, criteria, output_dir)
        verdict.fast_path = False
        if not verdict.passed and not verdict.failures:
            # 契约负例防御：passed=False 必须给出可反驳的结构化理由，
            # 否则标记一条占位失败，保证 failures 永远可追溯。
            verdict.failures.append(
                f"stage '{stage_id}' gate judge returned passed=False "
                "without structured failure reasons"
            )
        return verdict
    return GateVerdict(passed=True, stage_id=stage_id, fast_path=True, failures=[], suggestions=[])


def next_stage(current: str) -> str | None:
    try:
        idx = STAGE_ORDER.index(current)
    except ValueError:
        return None
    if idx + 1 >= len(STAGE_ORDER):
        return None
    return STAGE_ORDER[idx + 1]
