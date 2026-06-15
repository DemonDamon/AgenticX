#!/usr/bin/env python3
"""Smoke test for GAIA benchmark integration pipeline.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts import run_gaia_benchmark


def test_smoke_gaia_pipeline_end_to_end(tmp_path: Path, monkeypatch) -> None:
    dataset = tmp_path / "gaia.jsonl"
    dataset.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "task_id": "gaia-1",
                        "Question": "What is one plus one?",
                        "Level": "1",
                        "Final answer": "2",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "task_id": "gaia-2",
                        "Question": "What is two plus two?",
                        "Level": "1",
                        "Final answer": "4",
                    },
                    ensure_ascii=False,
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    output_dir = tmp_path / "out"
    monkeypatch.setattr(
        "sys.argv",
        [
            "run_gaia_benchmark.py",
            "--dataset-path",
            str(dataset),
            "--output-dir",
            str(output_dir),
            "--export-submission",
            "--benchmark-name",
            "gaia_smoke",
        ],
    )
    exit_code = run_gaia_benchmark.main()
    assert exit_code == 0

    result_file = output_dir / "results.jsonl"
    submission_file = output_dir / "submission.jsonl"
    manifest_file = output_dir / "manifest.json"
    assert result_file.exists()
    assert submission_file.exists()
    assert manifest_file.exists()

    result_text = result_file.read_text(encoding="utf-8")
    submission_text = submission_file.read_text(encoding="utf-8")
    assert "gaia-1" in result_text
    assert "gaia-2" in submission_text
