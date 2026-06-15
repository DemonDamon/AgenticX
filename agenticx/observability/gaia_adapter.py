#!/usr/bin/env python3
"""Convert GAIA records into AgenticX benchmark task payloads.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agenticx.core.task import Task
from agenticx.observability.gaia_loader import GaiaTaskRecord


@dataclass(frozen=True)
class GaiaTaskBundle:
    """Container for benchmark execution payloads."""

    tasks: list[Task]
    expected_outputs: list[str | None]
    task_metadata: list[dict[str, Any]]


def build_gaia_task_bundle(
    records: list[GaiaTaskRecord],
    *,
    dataset_root: Path | None = None,
    agent_id: str | None = None,
) -> GaiaTaskBundle:
    """Build AgenticX task bundle for GAIA benchmark execution."""
    tasks: list[Task] = []
    expected_outputs: list[str | None] = []
    task_metadata: list[dict[str, Any]] = []

    for record in records:
        attachment = _resolve_attachment_path(record, dataset_root=dataset_root)
        context: dict[str, Any] = {
            "benchmark": "gaia",
            "gaia_task_id": record.task_id,
            "level": record.level,
            "file_name": record.file_name,
            "file_path": record.file_path,
            "attachment_path": str(attachment) if attachment else None,
            "annotator_metadata": record.annotator_metadata,
        }
        task = Task(
            id=record.task_id,
            description=record.question,
            agent_id=agent_id,
            expected_output=(
                "Provide reasoning and end with "
                "'FINAL ANSWER: [YOUR FINAL ANSWER]' using GAIA answer conventions."
            ),
            context=context,
        )
        tasks.append(task)
        expected_outputs.append(record.final_answer)
        task_metadata.append(context)

    return GaiaTaskBundle(
        tasks=tasks,
        expected_outputs=expected_outputs,
        task_metadata=task_metadata,
    )


def _resolve_attachment_path(record: GaiaTaskRecord, *, dataset_root: Path | None) -> Path | None:
    """Resolve attachment path if this task has an attached file."""
    raw_path = record.file_path or record.file_name
    if not raw_path:
        return None
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    if dataset_root is None:
        return candidate
    return (dataset_root / candidate).resolve()
