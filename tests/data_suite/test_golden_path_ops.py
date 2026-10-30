"""H6 golden-path: schedule fires → job runs → history → rerun."""

from __future__ import annotations

import pytest

from examples.data_suite.golden_path.ops_stage import run_ops_stage
from examples.data_suite.golden_path.probe import build_golden_registry


@pytest.mark.asyncio
async def test_golden_ops_tick_history_rerun():
    registry = build_golden_registry()
    out = await run_ops_stage(registry=registry)

    assert out["job_id"] == "golden_path_members"
    assert out["cron"] == "0 3 * * *"
    assert len(out["tick_runs"]) == 1
    tick = out["tick_runs"][0]
    assert tick["trigger"] == "schedule"
    assert tick["status"] == "succeeded"
    assert tick["snapshot_id"]

    rerun = out["rerun"]
    assert rerun["trigger"] == "manual"
    assert rerun["status"] == "succeeded"

    history = out["history"]
    assert len(history) >= 2
    assert {h["trigger"] for h in history} >= {"schedule", "manual"}
    assert out["webhook_count"] == 0
