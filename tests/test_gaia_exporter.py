#!/usr/bin/env python3
"""Unit tests for GAIA exporter helpers.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.observability.gaia_exporter import build_submission_row, normalize_model_answer, write_jsonl


def test_normalize_model_answer_prefers_final_answer_suffix() -> None:
    output = "Reasoning.\nFINAL ANSWER: 123\n"
    assert normalize_model_answer(output) == "123"


def test_build_submission_row_shape() -> None:
    row = build_submission_row("task-1", "FINAL ANSWER: tokyo", reasoning_trace="trace")
    assert row["task_id"] == "task-1"
    assert row["model_answer"] == "tokyo"
    assert row["reasoning_trace"] == "trace"


def test_write_jsonl_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "submission.jsonl"
    rows = [
        {"task_id": "a", "model_answer": "1"},
        {"task_id": "b", "model_answer": "2"},
    ]
    write_jsonl(rows, path)
    text = path.read_text(encoding="utf-8")
    assert '"task_id": "a"' in text
    assert '"model_answer": "2"' in text
