#!/usr/bin/env python3
"""GAIA dataset loading and normalization utilities.

Author: Damon Li
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class GaiaTaskRecord:
    """Normalized GAIA task record."""

    task_id: str
    question: str
    level: str
    final_answer: str | None
    file_name: str | None
    file_path: str | None
    annotator_metadata: dict[str, Any]
    raw: dict[str, Any]


def load_gaia_tasks(
    dataset_path: Path | str,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[GaiaTaskRecord], list[str]]:
    """Load and validate GAIA task records from dataset files.

    Args:
        dataset_path: Path to a `.jsonl`, `.json`, or `.csv` file.
        limit: Optional max number of valid rows to return.
        offset: Number of rows to skip before collecting valid rows.

    Returns:
        A tuple of:
        - list of normalized records
        - list of non-fatal row errors
    """
    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found: {path}")

    rows = list(_iter_rows(path))
    start = max(offset, 0)
    selected_rows = rows[start:]

    records: list[GaiaTaskRecord] = []
    errors: list[str] = []
    seen_ids: set[str] = set()

    for index, row in enumerate(selected_rows, start=start):
        try:
            record = _normalize_row(row)
            if record.task_id in seen_ids:
                errors.append(f"Row {index}: duplicate task_id '{record.task_id}'")
                continue
            seen_ids.add(record.task_id)
            records.append(record)
            if limit is not None and len(records) >= limit:
                break
        except ValueError as exc:
            errors.append(f"Row {index}: {exc}")

    return records, errors


def _iter_rows(path: Path) -> Iterable[dict[str, Any]]:
    """Iterate row dictionaries from supported dataset file formats."""
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                if not isinstance(payload, dict):
                    raise ValueError("JSONL line is not an object")
                yield payload
        return

    if suffix == ".json":
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            for item in payload:
                if isinstance(item, dict):
                    yield item
            return
        if isinstance(payload, dict):
            for key in ("data", "tasks", "rows"):
                maybe_rows = payload.get(key)
                if isinstance(maybe_rows, list):
                    for item in maybe_rows:
                        if isinstance(item, dict):
                            yield item
                    return
        raise ValueError("Unsupported JSON structure; expected list or object with data/tasks/rows")

    if suffix == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield dict(row)
        return

    raise ValueError(f"Unsupported dataset format: {suffix}")


def _normalize_row(row: dict[str, Any]) -> GaiaTaskRecord:
    """Normalize source row into `GaiaTaskRecord`."""
    task_id = str(_first_non_empty(row, "task_id", "id")).strip()
    question = str(_first_non_empty(row, "Question", "question", "prompt")).strip()
    if not task_id:
        raise ValueError("missing required field 'task_id'")
    if not question:
        raise ValueError("missing required field 'Question'")

    level = str(row.get("Level", row.get("level", ""))).strip()
    final_answer_raw = row.get("Final answer", row.get("final_answer"))
    final_answer = str(final_answer_raw).strip() if final_answer_raw is not None else None
    if final_answer == "":
        final_answer = None

    file_name_raw = row.get("file_name")
    file_path_raw = row.get("file_path")
    file_name = str(file_name_raw).strip() if file_name_raw else None
    file_path = str(file_path_raw).strip() if file_path_raw else None

    metadata = row.get("Annotator Metadata", row.get("annotator_metadata", {}))
    if not isinstance(metadata, dict):
        metadata = {}

    return GaiaTaskRecord(
        task_id=task_id,
        question=question,
        level=level,
        final_answer=final_answer,
        file_name=file_name,
        file_path=file_path,
        annotator_metadata=metadata,
        raw=dict(row),
    )


def _first_non_empty(row: dict[str, Any], *keys: str) -> Any:
    """Return first non-empty field from candidate keys."""
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        return value
    return ""
