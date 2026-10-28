"""S1-2: golden-path DataFlow + OneID."""

from __future__ import annotations

import pytest

from examples.data_suite.golden_path.pipeline import dst_rows, run_job_stage
from examples.data_suite.golden_path.probe import build_golden_registry


@pytest.mark.asyncio
async def test_job_stage_writes_oneid_rows():
    registry = build_golden_registry()
    # Duplicate phone so two members merge to one subject
    src = registry.get("src")
    rows = list(src.tables["members"])
    rows[1] = {**rows[1], "phone": rows[0]["phone"], "external_id": ""}
    src.tables["members"] = rows

    result = await run_job_stage(registry=registry)
    assert result.ok is True, result.error
    assert result.written >= 1
    out = dst_rows(registry)
    assert len(out) == result.written
    subjects = {r.get("subject_id") for r in out}
    assert all(subjects)
    # shared phone should collapse at least one pair
    assert len(subjects) < len(rows)
    assert result.snapshot_id
