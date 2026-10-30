"""Load governance ops from file store into CleaningEngine / QualityRollup."""

from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.governance.cleaning import CleaningEngine
from agenticx.data_suite.store.file_store import CleaningRuleStore, QualityMetricStore


def test_cleaning_engine_from_store(tmp_path: Path) -> None:
    store = CleaningRuleStore(tmp_path)
    store.upsert_rule(
        {
            "id": "id_required",
            "template": "not_null",
            "field": "member_id",
            "params": {},
            "enabled": True,
        }
    )
    store.upsert_rule(
        {
            "id": "name_trim",
            "template": "trim",
            "field": "display_name",
            "params": {},
            "enabled": True,
        }
    )
    rules = [r for r in store.list_rules() if r.get("enabled", True)]
    eng = CleaningEngine()
    eng.load_rules(rules, ruleset_id="from-store")
    result = eng.apply(
        [
            {"member_id": "1", "display_name": "  Alice  "},
            {"member_id": None, "display_name": "x"},
        ]
    )
    assert len(result.rows) == 1
    assert result.rows[0]["display_name"] == "Alice"
    assert len(result.quarantine) == 1
    assert result.quarantine[0]["rule_id"] == "id_required"


def test_quality_rollup_from_store_run_day(tmp_path: Path) -> None:
    store = QualityMetricStore(tmp_path)
    store.upsert_metric({"id": "null_rate_member_id", "type": "null_rate", "field": "member_id"})
    store.upsert_metric({"id": "rule_fail_rate", "type": "rule_fail_rate", "field": ""})
    snap = store.run_day(
        "2026-10-30",
        [{"member_id": "1"}, {"member_id": None}],
        quarantine=[{"rule_id": "id_required"}],
    )
    assert snap["day"] == "2026-10-30"
    assert snap["metrics"]["null_rate_member_id"] == 0.5
    assert snap["metrics"]["rule_fail_rate"] == 0.5
    assert store.get_last_run() is not None
