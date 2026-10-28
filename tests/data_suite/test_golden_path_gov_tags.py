"""S1-3: golden-path governance + tags/audience."""

from __future__ import annotations

from examples.data_suite.golden_path.governance_stage import run_governance_stage
from examples.data_suite.golden_path.probe import load_member_seed
from examples.data_suite.golden_path.tags_stage import run_tags_stage


def test_governance_stage_on_seed():
    rows = load_member_seed()
    out = run_governance_stage(rows)
    assert out["catalog_fields"] >= 5
    assert "member_id" in out["field_names"]
    assert out["quality"]["metrics"]["null_rate_member_id"] == 0.0
    assert out["quality"]["metrics"]["distinct_member_id"] == float(len(rows))


def test_tags_audience_nonempty():
    rows = load_member_seed()
    out = run_tags_stage(rows)
    assert out["tagged"] == len(rows)
    assert "tag_status_active" in out["computed"]
    assert out["audience_size"] > 0
    assert all(i in {r["member_id"] for r in rows} for i in out["audience_ids"])
