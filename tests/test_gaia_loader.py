#!/usr/bin/env python3
"""Unit tests for GAIA task loader.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.observability.gaia_loader import load_gaia_tasks


def test_load_gaia_tasks_jsonl_success(tmp_path: Path) -> None:
    dataset = tmp_path / "metadata.jsonl"
    dataset.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "task_id": "t1",
                        "Question": "What is 1+1?",
                        "Level": "1",
                        "Final answer": "2",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "task_id": "t2",
                        "Question": "What is 2+2?",
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
    records, errors = load_gaia_tasks(dataset)
    assert not errors
    assert len(records) == 2
    assert records[0].task_id == "t1"
    assert records[0].question == "What is 1+1?"
    assert records[0].final_answer == "2"


def test_load_gaia_tasks_detects_missing_and_duplicate(tmp_path: Path) -> None:
    dataset = tmp_path / "broken.jsonl"
    dataset.write_text(
        "\n".join(
            [
                json.dumps({"task_id": "x1", "Question": "Q1"}, ensure_ascii=False),
                json.dumps({"task_id": "x1", "Question": "Q2"}, ensure_ascii=False),
                json.dumps({"Question": "No task id"}, ensure_ascii=False),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    records, errors = load_gaia_tasks(dataset)
    assert len(records) == 1
    assert len(errors) == 2
    assert any("duplicate task_id" in item for item in errors)
    assert any("missing required field 'task_id'" in item for item in errors)
