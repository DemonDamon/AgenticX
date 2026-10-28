"""Quality patrol template tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.managed.templates.data_suite import (
    FakeWebhookSink,
    QualityPatrolConfig,
    QualityPatrolRunner,
    WebhookNotifier,
)

FIX = Path(__file__).resolve().parents[2] / "data_suite" / "fixtures"
PATROL = FIX / "sample_quality_patrol.yaml"


def test_null_rate_breach_emits_webhook():
    cfg = QualityPatrolConfig.load(PATROL, fixtures_dir=FIX)
    sink = FakeWebhookSink()
    runner = QualityPatrolRunner(cfg, WebhookNotifier(sink))
    rows = [
        {"member_id": "1"},
        {"member_id": None},
        {"member_id": None},
    ]
    snap = runner.run(rows, quarantine=[{"rule_id": "x"}])
    assert snap.metrics["null_rate_member_id"] == pytest.approx(2 / 3)
    kinds = [e.kind for e in sink.events]
    assert "quality_alert" in kinds
    metrics = {e.payload["metric"] for e in sink.events if e.kind == "quality_alert"}
    assert "null_rate_member_id" in metrics
    assert "rule_fail_rate" in metrics


def test_under_threshold_silent():
    cfg = QualityPatrolConfig(
        metrics_yaml=FIX / "sample_quality_metrics.yaml",
        thresholds={"null_rate_member_id": 0.5},
        day="2026-10-28",
    )
    sink = FakeWebhookSink()
    runner = QualityPatrolRunner(cfg, WebhookNotifier(sink))
    runner.run([{"member_id": "1"}, {"member_id": "2"}])
    assert sink.events == []
