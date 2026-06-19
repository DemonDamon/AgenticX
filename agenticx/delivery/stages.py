#!/usr/bin/env python3
"""Stage artifact materialization for delivery dry-run and validation.

Author: Damon Li
"""

from __future__ import annotations

import textwrap
from pathlib import Path

from agenticx.delivery.plan_mdc import STAGE_ORDER


def materialize_stage_artifacts(
    stage_id: str,
    *,
    output_dir: Path,
    worktree_path: Path,
    project_name: str,
    input_files: list[str],
    dry_run: bool = True,
) -> list[str]:
    """Create expected stage outputs (stub in dry-run, scaffold in live bootstrap)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    rel_paths: list[str] = []

    def rel(p: Path) -> str:
        return str(p.relative_to(worktree_path))

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


def next_stage(current: str) -> str | None:
    try:
        idx = STAGE_ORDER.index(current)
    except ValueError:
        return None
    if idx + 1 >= len(STAGE_ORDER):
        return None
    return STAGE_ORDER[idx + 1]
