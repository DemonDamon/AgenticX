"""S1-5 / H10: full golden-path spine e2e gate (includes H6 OPS)."""

from __future__ import annotations

import pytest

from examples.data_suite.golden_path.board_stage import run_board_stage
from examples.data_suite.golden_path.governance_stage import run_governance_stage
from examples.data_suite.golden_path.ops_stage import run_ops_stage
from examples.data_suite.golden_path.patrol_stage import run_patrol_stage
from examples.data_suite.golden_path.pipeline import dst_rows
from examples.data_suite.golden_path.probe import build_golden_registry, probe_src
from examples.data_suite.golden_path.tags_stage import run_tags_stage


@pytest.mark.asyncio
async def test_golden_path_full_spine():
    registry = build_golden_registry(kind="fake")
    probe = probe_src(registry)
    assert probe.ok and "members" in probe.tables

    ops = await run_ops_stage(registry=registry)
    assert ops["tick_runs"][0]["status"] == "succeeded"
    assert ops["rerun"]["status"] == "succeeded"
    assert len(ops["history"]) >= 2

    rows = dst_rows(registry)
    assert len(rows) >= 1

    gov = run_governance_stage(rows)
    assert gov["catalog_fields"] >= 5

    tags = run_tags_stage(rows)
    assert tags["audience_size"] >= 0

    board = run_board_stage(rows, role="analyst")
    assert len(board["widgets"]) >= 3
    assert board["raw_sample"].get("email") != board["masked_sample"].get("email")

    patrol = run_patrol_stage(rows)
    assert patrol["webhook_count"] >= 1
    kinds = set(patrol["webhook_kinds"])
    assert "quality_alert" in kinds or "dict_drift" in kinds
