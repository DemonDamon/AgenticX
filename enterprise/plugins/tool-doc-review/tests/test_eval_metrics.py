#!/usr/bin/env python3
"""Tests for eval metrics.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from eval_metrics import score


def test_score_computes_miss_and_false_alarm_rates() -> None:
    expected = [
        {"category": "二类", "locator": "图2", "kind": "缺号"},
        {"category": "二类", "locator": "heading", "kind": "跳级"},
    ]
    findings = [
        {
            "category": "二类",
            "rule_id": "figure-numbering-missing",
            "matched": "图2",
            "message": "Missing 图 number: 2",
        },
        {
            "category": "二类",
            "rule_id": "extra",
            "matched": "noise",
            "message": "unexpected",
        },
    ]
    metrics = score(expected, findings)
    assert metrics["二类"]["missed"] == 1
    assert metrics["二类"]["matched_count"] == 1
    assert metrics["二类"]["false_alarm_rate"] == 0.5


def test_eval_metrics_cli_roundtrip(flawed_docx: Path, flawed_labels: Path, tmp_path: Path) -> None:
    import subprocess
    import sys

    report_path = tmp_path / "report.json"
    metrics_path = tmp_path / "metrics.json"
    cli = Path(__file__).resolve().parent.parent / "doc_review_cli.py"
    eval_cli = Path(__file__).resolve().parent.parent / "eval_metrics.py"

    subprocess.run(
        [
            sys.executable,
            str(cli),
            "--input",
            str(flawed_docx),
            "--format-check",
            "--output",
            str(report_path),
        ],
        check=True,
        cwd=str(cli.parent),
    )
    subprocess.run(
        [
            sys.executable,
            str(eval_cli),
            "--expected",
            str(flawed_labels),
            "--report",
            str(report_path),
            "--output",
            str(metrics_path),
        ],
        check=True,
        cwd=str(eval_cli.parent),
    )
    payload = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert "二类" in payload["categories"]
