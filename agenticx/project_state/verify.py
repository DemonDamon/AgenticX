#!/usr/bin/env python3
"""verify.yaml runner for project_state E2E gates.

Author: Damon Li
"""

from __future__ import annotations

import shlex
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.project_state.store import ProjectStateError, ProjectStore

VERIFY_SCHEMA_VERSION = 1
ALLOWED_STEP_TYPES = {"shell", "pytest", "npm", "lint"}


@dataclass
class StepResult:
    name: str
    type: str
    passed: bool
    exit_code: int
    duration_sec: float
    timeout: bool = False
    log_excerpt: str = ""


@dataclass
class VerifyResult:
    passed: bool
    steps: List[StepResult] = field(default_factory=list)
    summary: str = ""
    log_path: Optional[Path] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "summary": self.summary,
            "log_path": str(self.log_path) if self.log_path else None,
            "steps": [
                {
                    "name": s.name,
                    "type": s.type,
                    "passed": s.passed,
                    "exit_code": s.exit_code,
                    "duration_sec": round(s.duration_sec, 3),
                    "timeout": s.timeout,
                }
                for s in self.steps
            ],
        }


def _load_yaml(path: Path) -> Dict[str, Any]:
    import yaml  # type: ignore

    if not path.is_file():
        raise ProjectStateError(f"verify.yaml not found at {path}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:  # pragma: no cover - defensive
        raise ProjectStateError(f"verify.yaml parse failed: {exc}") from exc
    if not isinstance(data, dict):
        raise ProjectStateError("verify.yaml root must be a mapping")
    version = int(data.get("schema_version", VERIFY_SCHEMA_VERSION) or VERIFY_SCHEMA_VERSION)
    if version != VERIFY_SCHEMA_VERSION:
        raise ProjectStateError(f"unsupported verify.yaml schema_version: {version}")
    return data


def _build_command(step: Dict[str, Any]) -> List[str]:
    step_type = str(step.get("type", "shell")).strip().lower()
    if step_type not in ALLOWED_STEP_TYPES:
        raise ProjectStateError(f"unsupported verify step type: {step_type}")
    if step_type == "shell":
        cmd = step.get("cmd")
        if not cmd or not isinstance(cmd, str):
            raise ProjectStateError("shell step requires non-empty cmd string")
        return ["bash", "-lc", cmd]
    if step_type == "pytest":
        args = step.get("args") or []
        if not isinstance(args, list):
            raise ProjectStateError("pytest step args must be list")
        return ["python", "-m", "pytest", *[str(x) for x in args]]
    if step_type == "npm":
        script = step.get("script")
        if not script or not isinstance(script, str):
            raise ProjectStateError("npm step requires script string")
        return ["npm", "run", script]
    if step_type == "lint":
        cmd = step.get("cmd")
        if not cmd or not isinstance(cmd, str):
            raise ProjectStateError("lint step requires cmd string")
        return shlex.split(cmd)
    raise ProjectStateError(f"unhandled step type: {step_type}")


def run_verify(
    store: ProjectStore,
    *,
    workspace_root: Path,
    feature_id: Optional[str] = None,
    only_step: Optional[str] = None,
) -> VerifyResult:
    """Run all (or one) steps from verify.yaml under ``workspace_root``."""
    config = _load_yaml(store.verify_yaml_path)
    steps_raw = config.get("steps") or []
    if not isinstance(steps_raw, list) or not steps_raw:
        raise ProjectStateError("verify.yaml must define a non-empty steps list")

    workspace_root = Path(workspace_root).expanduser().resolve()
    if not workspace_root.is_dir():
        raise ProjectStateError(f"workspace_root is not a directory: {workspace_root}")

    log_lines: List[str] = []
    step_results: List[StepResult] = []
    overall_passed = True

    for raw in steps_raw:
        if not isinstance(raw, dict):
            raise ProjectStateError("verify step must be a mapping")
        name = str(raw.get("name") or raw.get("type") or "step").strip()
        step_type = str(raw.get("type", "shell")).strip().lower()
        if only_step and only_step != name:
            continue
        timeout_sec = float(raw.get("timeout_sec", 600) or 600)
        cmd = _build_command(raw)
        log_lines.append(f"\n===== step: {name} ({step_type}) =====")
        log_lines.append(f"$ {' '.join(shlex.quote(c) for c in cmd)}")
        start = time.monotonic()
        timed_out = False
        exit_code = -1
        stdout_text = ""
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                check=False,
            )
            exit_code = int(proc.returncode)
            stdout_text = (proc.stdout or "") + (proc.stderr or "")
        except subprocess.TimeoutExpired as exc:  # pragma: no cover - timing
            timed_out = True
            stdout_text = (exc.stdout or "") + (exc.stderr or "") if isinstance(exc.stdout, str) else ""
            exit_code = 124
        except FileNotFoundError as exc:
            stdout_text = f"command not found: {exc}"
            exit_code = 127

        duration = time.monotonic() - start
        log_lines.append(stdout_text)
        passed = (not timed_out) and exit_code == 0
        excerpt = "\n".join(stdout_text.splitlines()[-100:])
        step_results.append(
            StepResult(
                name=name,
                type=step_type,
                passed=passed,
                exit_code=exit_code,
                duration_sec=duration,
                timeout=timed_out,
                log_excerpt=excerpt,
            )
        )
        if not passed:
            overall_passed = False
            log_lines.append(f"[step {name}] FAIL exit={exit_code} timeout={timed_out}")
            break
        log_lines.append(f"[step {name}] PASS ({duration:.2f}s)")

    summary_lines = [
        f"verify {'PASS' if overall_passed else 'FAIL'}: "
        f"{sum(1 for s in step_results if s.passed)}/{len(step_results)} steps passed",
    ]
    if not overall_passed and step_results:
        last = step_results[-1]
        summary_lines.append(
            f"failed step: {last.name} type={last.type} exit={last.exit_code} timeout={last.timeout}"
        )

    log_path = store.archive_log(
        feature_id or "_general",
        "log",
        "\n".join(log_lines) + "\n",
    )

    return VerifyResult(
        passed=overall_passed,
        steps=step_results,
        summary="\n".join(summary_lines),
        log_path=log_path,
    )
