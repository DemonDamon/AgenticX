from pathlib import Path

import pytest

from agenticx.data_suite.governance.quality import QualityRollup

FIXTURE = Path(__file__).parent / "fixtures" / "sample_quality_metrics.yaml"


def test_null_rate_and_distinct_and_fail_rate(tmp_path):
    rollup = QualityRollup()
    rollup.load_metrics(FIXTURE)
    rows = [
        {"member_id": "1"},
        {"member_id": None},
        {"member_id": "1"},
    ]
    quarantine = [{"rule_id": "x", "row": {}, "reason": "bad"}]
    snap = rollup.compute_day("2026-10-28", rows, quarantine=quarantine)
    assert snap.day == "2026-10-28"
    assert snap.metrics["null_rate_member_id"] == pytest.approx(1 / 3)
    assert snap.metrics["distinct_member_id"] == 1.0
    assert snap.metrics["rule_fail_rate"] == pytest.approx(1 / 3)
    out = tmp_path / "snap.yaml"
    rollup.save(snap, out)
    loaded = rollup.load_day(out)
    assert loaded.day == snap.day
    assert loaded.metrics == snap.metrics
