#!/usr/bin/env python3
"""Validate GAIA leaderboard submission files.

Author: Damon Li
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


GAIA_SCHEMA_VERSION = "gaia_leaderboard_v1"


@dataclass(frozen=True)
class ValidationIssue:
    """Represents one schema validation issue."""

    line: int
    message: str


def validate_submission_jsonl(
    path: Path | str,
    *,
    schema_version: str = GAIA_SCHEMA_VERSION,
) -> list[ValidationIssue]:
    """Validate GAIA submission JSONL file and return all issues."""
    if schema_version != GAIA_SCHEMA_VERSION:
        return [ValidationIssue(line=0, message=f"unsupported schema_version: {schema_version}")]

    file_path = Path(path)
    if not file_path.exists():
        return [ValidationIssue(line=0, message=f"file not found: {file_path}")]

    issues: list[ValidationIssue] = []
    seen_ids: set[str] = set()

    with file_path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                issues.append(ValidationIssue(line=line_no, message=f"invalid JSON: {exc}"))
                continue

            if not isinstance(payload, dict):
                issues.append(ValidationIssue(line=line_no, message="row must be a JSON object"))
                continue

            task_id = payload.get("task_id")
            model_answer = payload.get("model_answer")
            if not isinstance(task_id, str) or not task_id.strip():
                issues.append(ValidationIssue(line=line_no, message="task_id must be a non-empty string"))
            else:
                if task_id in seen_ids:
                    issues.append(ValidationIssue(line=line_no, message=f"duplicate task_id: {task_id}"))
                seen_ids.add(task_id)

            if not isinstance(model_answer, str):
                issues.append(ValidationIssue(line=line_no, message="model_answer must be a string"))

            reasoning_trace = payload.get("reasoning_trace")
            if reasoning_trace is not None and not isinstance(reasoning_trace, str):
                issues.append(ValidationIssue(line=line_no, message="reasoning_trace must be a string when set"))

    if not seen_ids:
        issues.append(ValidationIssue(line=0, message="submission has no rows"))

    return issues
