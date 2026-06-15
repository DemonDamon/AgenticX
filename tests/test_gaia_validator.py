#!/usr/bin/env python3
"""Unit tests for GAIA submission validator.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.observability.gaia_validator import validate_submission_jsonl


def test_validate_submission_jsonl_ok(tmp_path: Path) -> None:
    submission = tmp_path / "submission.jsonl"
    submission.write_text(
        '{"task_id":"t1","model_answer":"42"}\n{"task_id":"t2","model_answer":"tokyo"}\n',
        encoding="utf-8",
    )
    issues = validate_submission_jsonl(submission)
    assert not issues


def test_validate_submission_jsonl_reports_errors(tmp_path: Path) -> None:
    submission = tmp_path / "submission.jsonl"
    submission.write_text(
        '{"task_id":"t1","model_answer":"42"}\n'
        '{"task_id":"t1","model_answer":1}\n'
        '{"model_answer":"missing id"}\n',
        encoding="utf-8",
    )
    issues = validate_submission_jsonl(submission)
    assert issues
    messages = [item.message for item in issues]
    assert any("duplicate task_id" in item for item in messages)
    assert any("model_answer must be a string" in item for item in messages)
    assert any("task_id must be a non-empty string" in item for item in messages)
