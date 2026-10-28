"""A8 e2e gate: examples validate + schedule ticks + nl2sql deny write."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agenticx.managed.manifest import validate_manifest
from agenticx.managed.templates.data_suite import (
    DictDriftConfig,
    DictDriftRunner,
    FakeQueryChannel,
    FakeWebhookSink,
    QualityPatrolConfig,
    QualityPatrolRunner,
    ReadOnlySqlExecutor,
    WebhookNotifier,
    assert_read_only_tools,
    run_scheduled,
)

ROOT = Path(__file__).resolve().parents[3]
EX = ROOT / "examples" / "managed" / "data_suite"
FIX = ROOT / "tests" / "data_suite" / "fixtures"


@pytest.mark.parametrize(
    "name",
    ["quality-patrol.apply.yaml", "dict-drift.apply.yaml", "nl2sql.apply.yaml"],
)
def test_example_manifests_validate(name):
    raw = yaml.safe_load((EX / name).read_text(encoding="utf-8"))
    manifest = raw["manifest"]
    result = validate_manifest(manifest)
    assert result.ok, getattr(result, "errors", result)
    assert_read_only_tools(manifest)


def test_schedule_tick_quality_and_drift():
    sink = FakeWebhookSink()
    notifier = WebhookNotifier(sink)

    def tick():
        qcfg = QualityPatrolConfig.load(FIX / "sample_quality_patrol.yaml", fixtures_dir=FIX)
        QualityPatrolRunner(qcfg, notifier).run(
            [{"member_id": None}, {"member_id": None}, {"member_id": "1"}],
            quarantine=[{"rule_id": "x"}],
        )
        dcfg = DictDriftConfig(
            dictionary_yaml=FIX / "sample_dictionary.yaml",
            null_rate_ceiling=0.1,
            require_fields=("member_id", "ghost_field"),
        )
        DictDriftRunner(dcfg, notifier).run([{"member_id": None}, {"member_id": None}])
        return {"ok": True}

    out = run_scheduled(tick, tick_id="e2e-1")
    assert out["tick_id"] == "e2e-1"
    kinds = {e.kind for e in sink.events}
    assert "quality_alert" in kinds
    assert "dict_drift" in kinds


def test_nl2sql_rejects_insert():
    ex = ReadOnlySqlExecutor(FakeQueryChannel())
    with pytest.raises(PermissionError):
        ex.execute("INSERT INTO t VALUES (1)")
