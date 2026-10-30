"""Platform metering recorder (Python) tests for patrol / managed usage."""

from __future__ import annotations

from pathlib import Path

from agenticx.managed.metering import (
    InMemoryMeteringStore,
    PatrolMeteringContext,
    UsageRecord,
    record_patrol_usage,
)
from agenticx.managed.templates.data_suite import PatrolScheduleConfig, run_patrol_tick

FIX = Path(__file__).resolve().parents[1] / "data_suite" / "fixtures"


def test_in_memory_record_usage_shape():
    store = InMemoryMeteringStore()
    rec = store.record(
        UsageRecord(
            tenant_id="ten-1",
            provider="openai",
            model="gpt-test",
            time_bucket="2026-10-30T11:00:00Z",
            cost_usd=0.01,
            route="chat",
            input_tokens=10,
            output_tokens=5,
        )
    )
    assert rec.id
    assert rec.total_tokens == 15
    assert len(store.records) == 1
    assert store.records[0].tenant_id == "ten-1"


def test_record_patrol_usage_helper():
    store = InMemoryMeteringStore()
    rec = record_patrol_usage(
        store,
        tenant_id="ten-1",
        tick_id="tick-a",
        webhook_count=2,
        todos=1,
    )
    assert rec.route == "patrol"
    assert rec.agent_id == "data_suite_patrol"
    assert rec.metadata["tick_id"] == "tick-a"
    assert store.by_route("patrol") == [rec]


def test_run_patrol_tick_records_metering():
    cfg = PatrolScheduleConfig(
        tick_id="meter-fake",
        cron="0 6 * * *",
        webhook_url=None,
        quality_patrol_yaml=FIX / "sample_quality_patrol.yaml",
        dict_drift_yaml=FIX / "sample_dict_drift.yaml",
        fixtures_dir=FIX,
    )
    rows = [
        {"member_id": None, "phone": None},
        {"member_id": None, "phone": "1"},
        {"member_id": "1", "phone": "2"},
    ]
    store = InMemoryMeteringStore()
    out = run_patrol_tick(
        rows,
        cfg=cfg,
        quarantine=[{"rule_id": "x"}],
        metering=store,
        metering_context=PatrolMeteringContext(tenant_id="ten-patrol", user_id="ops"),
    )
    assert out["tick_id"] == "meter-fake"
    assert out["metering_record"] is not None
    assert out["metering_record"].route == "patrol"
    assert out["metering_record"].tenant_id == "ten-patrol"
    assert len(store.by_route("patrol")) == 1
    assert store.records[0].metadata["tick_id"] == "meter-fake"


def test_run_patrol_tick_without_metering_unchanged():
    cfg = PatrolScheduleConfig(
        tick_id="no-meter",
        cron="0 6 * * *",
        webhook_url=None,
        quality_patrol_yaml=FIX / "sample_quality_patrol.yaml",
        dict_drift_yaml=FIX / "sample_dict_drift.yaml",
        fixtures_dir=FIX,
    )
    out = run_patrol_tick(
        [{"member_id": "1", "phone": "2"}],
        cfg=cfg,
    )
    assert out.get("metering_record") is None
