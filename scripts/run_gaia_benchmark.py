#!/usr/bin/env python3
"""Run GAIA benchmark with AgenticX BenchmarkRunner.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from agenticx.observability.gaia_adapter import GaiaTaskBundle, build_gaia_task_bundle
from agenticx.observability.gaia_exporter import build_submission_row, write_jsonl
from agenticx.observability.gaia_loader import load_gaia_tasks
from agenticx.observability.gaia_model_registry import (
    format_allowed_models,
    resolve_gaia_model,
    verify_provider_ready,
)
from agenticx.observability.gaia_runner import (
    GaiaBenchmarkRunner,
    print_gaia_run_banner,
    run_gaia_tasks_sequential,
)
from agenticx.observability.gaia_validator import (
    GAIA_SCHEMA_VERSION,
    ValidationIssue,
    validate_submission_jsonl,
)

@dataclass
class PlaceholderAgent:
    """Minimal benchmark agent holder used by BenchmarkRunner."""

    id: str


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Run GAIA benchmark integration pipeline.")
    parser.add_argument("--dataset-path", type=Path, required=True, help="GAIA dataset file path")
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=None,
        help="Dataset root used to resolve relative attachment paths",
    )
    parser.add_argument("--benchmark-name", type=str, default="gaia_benchmark")
    parser.add_argument("--agent-id", type=str, default="gaia-eval-agent")
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help=f"LLM model id (required unless --dry-run). Allowed: {format_allowed_models()}",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        help="Optional provider override (defaults to config match or built-in hint)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use placeholder answers (pipeline smoke only, no LLM calls)",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/gaia"))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=600.0, help="Per-task timeout in seconds (default: 600)")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true", help="Skip task_ids already in results.jsonl")
    parser.add_argument("--force-rerun", action="store_true", help="Ignore previous outputs even if present")
    parser.add_argument("--export-submission", action="store_true", help="Generate submission.jsonl")
    parser.add_argument("--validate-only", action="store_true", help="Validate submission file and exit")
    parser.add_argument(
        "--submission-file",
        type=Path,
        default=None,
        help="Submission file path used by --validate-only (default output-dir/submission.jsonl)",
    )
    parser.add_argument("--schema-version", type=str, default=GAIA_SCHEMA_VERSION)
    return parser.parse_args()


def main() -> int:
    """Entry point."""
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    result_path = output_dir / "results.jsonl"
    submission_path = args.submission_file or (output_dir / "submission.jsonl")
    manifest_path = output_dir / "manifest.json"

    if args.validate_only:
        issues = validate_submission_jsonl(submission_path, schema_version=args.schema_version)
        return _print_validation_issues(issues, submission_path)

    if not args.dry_run and not args.model:
        print(
            f"--model is required for real GAIA runs. Allowed models: {format_allowed_models()}",
            file=sys.stderr,
        )
        return 1

    model_selection = None
    if args.model:
        try:
            model_selection = resolve_gaia_model(args.model, provider_override=args.provider)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    records, row_errors = load_gaia_tasks(args.dataset_path, limit=args.limit, offset=args.offset)
    if not records:
        print("No valid GAIA tasks loaded.", file=sys.stderr)
        for item in row_errors:
            print(f"- {item}", file=sys.stderr)
        return 1

    bundle = build_gaia_task_bundle(
        records,
        dataset_root=args.dataset_root or args.dataset_path.parent,
        agent_id=args.agent_id,
    )

    existing_rows = _load_existing_rows(result_path) if args.resume and not args.force_rerun else []
    existing_ids = {str(row.get("task_id", "")) for row in existing_rows if row.get("task_id")}
    pending_bundle = _filter_bundle(bundle, existing_ids=existing_ids)

    if not pending_bundle.tasks:
        print("No pending tasks to run (resume hit all task_ids).")
        if args.export_submission:
            submission_rows = _build_submission_from_results(existing_rows)
            write_jsonl(submission_rows, submission_path)
            issues = validate_submission_jsonl(submission_path, schema_version=args.schema_version)
            if issues:
                return _print_validation_issues(issues, submission_path)
        _write_manifest(
            manifest_path=manifest_path,
            benchmark_name=args.benchmark_name,
            dataset_path=args.dataset_path,
            agent_id=args.agent_id,
            loaded_tasks=len(records),
            resumed_tasks=len(existing_ids),
            executed_tasks=0,
            row_errors=row_errors,
            validation_errors=[],
            args_dict=vars(args),
            model_selection=model_selection,
        )
        return 0

    if model_selection and not args.dry_run:
        try:
            verify_provider_ready(model_selection)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    task_timeout = float(args.timeout or 600.0)
    print_gaia_run_banner(
        model=model_selection.model if model_selection else (args.model or ""),
        provider=model_selection.provider if model_selection else (args.provider or ""),
        total_tasks=len(pending_bundle.tasks),
        output_dir=str(output_dir),
        task_timeout=task_timeout,
        dry_run=args.dry_run,
    )

    if args.dry_run:
        bench_result = None
        runner = GaiaBenchmarkRunner(
            model=args.model or "",
            provider=args.provider,
            dry_run=True,
            max_workers=args.max_workers,
        )
        bench_result = runner.run_benchmark(
            benchmark_name=args.benchmark_name,
            agent=PlaceholderAgent(id=args.agent_id),
            tasks=pending_bundle.tasks,
            expected_outputs=pending_bundle.expected_outputs,
            timeout=args.timeout,
        )
        new_rows = _build_detailed_rows(
            bundle=pending_bundle,
            task_results=runner.last_task_results,
            benchmark_name=args.benchmark_name,
        )
        all_rows = existing_rows + new_rows
        write_jsonl(all_rows, result_path)
    else:
        incremental_rows: list[dict[str, Any]] = list(existing_rows)

        def _on_task_done(index: int, _total: int, task: Any, raw: dict[str, Any]) -> None:
            meta = pending_bundle.task_metadata[index - 1]
            expected = pending_bundle.expected_outputs[index - 1]
            row = _build_single_row(
                task=task,
                expected=expected,
                meta=meta,
                raw_result=raw,
                benchmark_name=args.benchmark_name,
            )
            incremental_rows.append(row)
            _append_jsonl_row(result_path, row)

        task_results = run_gaia_tasks_sequential(
            pending_bundle.tasks,
            model=args.model or "",
            provider=args.provider,
            task_timeout=task_timeout,
            on_task_done=_on_task_done,
        )
        all_rows = incremental_rows
        completed = sum(1 for item in task_results if item.get("success"))
        failed = len(task_results) - completed
        bench_result = None
        print(
            f"[gaia] batch finished ok={completed} fail={failed} results={result_path}",
            flush=True,
        )

    validation_errors: list[str] = []
    if args.export_submission:
        submission_rows = _build_submission_from_results(all_rows)
        write_jsonl(submission_rows, submission_path)
        issues = validate_submission_jsonl(submission_path, schema_version=args.schema_version)
        if issues:
            validation_errors = [f"line {issue.line}: {issue.message}" for issue in issues]

    _write_manifest(
        manifest_path=manifest_path,
        benchmark_name=args.benchmark_name,
        dataset_path=args.dataset_path,
        agent_id=args.agent_id,
        loaded_tasks=len(records),
        resumed_tasks=len(existing_ids),
        executed_tasks=len(pending_bundle.tasks),
        row_errors=row_errors,
        validation_errors=validation_errors,
        args_dict=vars(args),
        benchmark_result=bench_result.to_dict() if bench_result is not None else None,
        model_selection=model_selection,
    )

    if validation_errors:
        print("Submission validation failed:")
        for item in validation_errors:
            print(f"- {item}")
        return 2

    print(
        "GAIA benchmark done: "
        f"loaded={len(records)} resumed={len(existing_ids)} executed={len(pending_bundle.tasks)} "
        f"results={result_path}"
    )
    return 0


def _filter_bundle(bundle: GaiaTaskBundle, *, existing_ids: set[str]) -> GaiaTaskBundle:
    """Filter task bundle by existing task IDs."""
    tasks = []
    expected = []
    metadata = []
    for task, expected_output, task_metadata in zip(
        bundle.tasks,
        bundle.expected_outputs,
        bundle.task_metadata,
        strict=True,
    ):
        if task.id in existing_ids:
            continue
        tasks.append(task)
        expected.append(expected_output)
        metadata.append(task_metadata)
    return GaiaTaskBundle(tasks=tasks, expected_outputs=expected, task_metadata=metadata)


def _build_single_row(
    *,
    task: Any,
    expected: Any,
    meta: dict[str, Any],
    raw_result: dict[str, Any],
    benchmark_name: str,
) -> dict[str, Any]:
    """Build one detailed GAIA result row."""
    raw_output = raw_result.get("result")
    return {
        "benchmark_name": benchmark_name,
        "task_id": task.id,
        "question": task.description,
        "level": meta.get("level"),
        "expected_output": expected,
        "success": bool(raw_result.get("success", False)),
        "error": raw_result.get("error"),
        "execution_time": raw_result.get("execution_time"),
        "provider": raw_result.get("provider"),
        "model": raw_result.get("model"),
        "raw_output": raw_output,
        "normalized_answer": build_submission_row(task.id, raw_output).get("model_answer"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _append_jsonl_row(path: Path, row: dict[str, Any]) -> None:
    """Append one JSON object as a line (incremental progress persistence)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _build_detailed_rows(
    *,
    bundle: GaiaTaskBundle,
    task_results: list[dict[str, Any]],
    benchmark_name: str,
) -> list[dict[str, Any]]:
    """Build detailed result rows for all executed tasks."""
    rows: list[dict[str, Any]] = []
    for index, (task, expected, meta) in enumerate(
        zip(bundle.tasks, bundle.expected_outputs, bundle.task_metadata, strict=True)
    ):
        raw_result = task_results[index] if index < len(task_results) else {}
        rows.append(
            _build_single_row(
                task=task,
                expected=expected,
                meta=meta,
                raw_result=raw_result,
                benchmark_name=benchmark_name,
            )
        )
    return rows


def _build_submission_from_results(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Convert detailed rows to GAIA submission rows."""
    return [
        build_submission_row(
            task_id=str(item.get("task_id", "")),
            raw_output=item.get("raw_output"),
        )
        for item in rows
    ]


def _load_existing_rows(path: Path) -> list[dict[str, Any]]:
    """Load existing result rows from JSONL file."""
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def _write_manifest(
    *,
    manifest_path: Path,
    benchmark_name: str,
    dataset_path: Path,
    agent_id: str,
    loaded_tasks: int,
    resumed_tasks: int,
    executed_tasks: int,
    row_errors: list[str],
    validation_errors: list[str],
    args_dict: dict[str, Any],
    benchmark_result: dict[str, Any] | None = None,
    model_selection: Any | None = None,
) -> None:
    """Write run manifest for reproducibility."""
    manifest = {
        "benchmark_name": benchmark_name,
        "agent_id": agent_id,
        "dataset_path": str(dataset_path.resolve()),
        "loaded_tasks": loaded_tasks,
        "resumed_tasks": resumed_tasks,
        "executed_tasks": executed_tasks,
        "row_errors": row_errors,
        "validation_errors": validation_errors,
        "schema_version": GAIA_SCHEMA_VERSION,
        "args": _json_safe(args_dict),
        "git_commit": _get_git_commit(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "benchmark_result": benchmark_result,
    }
    if model_selection is not None:
        manifest["model"] = getattr(model_selection, "model", None)
        manifest["provider"] = getattr(model_selection, "provider", None)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def _json_safe(payload: dict[str, Any]) -> dict[str, Any]:
    """Make dict values JSON serializable."""
    safe: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, Path):
            safe[key] = str(value)
        else:
            safe[key] = value
    return safe


def _get_git_commit() -> str:
    """Get current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def _print_validation_issues(issues: list[ValidationIssue], submission_path: Path) -> int:
    """Print schema issues and return process exit code."""
    if not issues:
        print(f"Submission valid: {submission_path}")
        return 0
    print(f"Submission invalid: {submission_path}")
    for issue in issues:
        print(f"- line {issue.line}: {issue.message}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
