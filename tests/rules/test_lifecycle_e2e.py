"""R1 lifecycle e2e: draft → pending → active → compile → execution."""

from __future__ import annotations

from pathlib import Path

from examples.rules.run_lifecycle import SAMPLE, load_sample_rule, run_lifecycle
from agenticx.rules.compile import compile_rule
from agenticx.rules.execution import ExecutionFileStore
from agenticx.rules.model import RuleStatus
from agenticx.rules.store import RuleFileStore


def test_sample_yaml_is_desensitized() -> None:
    text = SAMPLE.read_text(encoding="utf-8").lower()
    assert "proposal" not in text
    assert "brand-a" in text


def test_lifecycle_e2e(tmp_path: Path) -> None:
    report = run_lifecycle(tmp_path)
    assert report["status"] == "active"
    assert report["backend"] == "flow"
    assert report["node_types"][0] == "trigger"
    assert "condition" in report["node_types"]
    assert "action" in report["node_types"]
    assert report["execution_status"] == "completed"

    store = RuleFileStore(tmp_path)
    rule = store.get_rule(report["rule_id"])
    assert rule.status is RuleStatus.ACTIVE
    assert rule.enabled is True

    execs = ExecutionFileStore(tmp_path)
    rows = execs.list_executions(rule_id=rule.id)
    assert len(rows) == 1
    assert rows[0].nodes
    # recompile stays stable
    plan = compile_rule(rule)
    assert plan.rule_id == rule.id


def test_load_sample_rule_body_valid() -> None:
    rule = load_sample_rule()
    assert rule.id.startswith("brand-a")
    assert rule.body["object"] == "device"
