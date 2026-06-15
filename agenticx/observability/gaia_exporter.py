#!/usr/bin/env python3
"""GAIA benchmark result normalization and export helpers.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


FINAL_ANSWER_PATTERN = re.compile(r"FINAL ANSWER:\s*(.+)$", re.IGNORECASE | re.DOTALL)


def normalize_model_answer(raw_output: Any) -> str:
    """Normalize model output into GAIA `model_answer` field."""
    text = "" if raw_output is None else str(raw_output)
    match = FINAL_ANSWER_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()


def build_submission_row(
    task_id: str,
    raw_output: Any,
    *,
    reasoning_trace: str | None = None,
) -> dict[str, str]:
    """Build one GAIA submission row."""
    row: dict[str, str] = {
        "task_id": str(task_id),
        "model_answer": normalize_model_answer(raw_output),
    }
    if reasoning_trace:
        row["reasoning_trace"] = reasoning_trace
    return row


def write_jsonl(rows: list[dict[str, Any]], path: Path | str) -> Path:
    """Write dictionaries to JSONL file."""
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return output
