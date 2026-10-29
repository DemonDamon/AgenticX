"""Rule DSL parse and validation."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agenticx.rules.dsl import RuleDslError, parse_rule_body, validate_rule_body
from agenticx.rules.model import Rule
from agenticx.rules.store import RuleFileStore


MINIMAL = {
    "object": "device",
    "trigger": {"type": "event", "event": "metric.breach"},
    "condition": {"field": "temperature", "op": "gt", "value": 80},
    "actions": [{"type": "notify", "target": "ops-channel", "params": {"level": "warn"}}],
    "feedback": {"channel": "ops-channel"},
}


def test_parse_minimal_dict() -> None:
    body = parse_rule_body(MINIMAL)
    assert body.object == "device"
    assert body.trigger["type"] == "event"
    assert body.condition.field == "temperature"
    assert body.condition.op == "gt"
    assert body.condition.value == 80
    assert len(body.actions) == 1
    assert body.actions[0].type == "notify"
    assert body.feedback["channel"] == "ops-channel"


def test_parse_nested_bool_condition() -> None:
    raw = {
        **MINIMAL,
        "condition": {
            "op": "and",
            "args": [
                {"field": "temperature", "op": "gt", "value": 80},
                {"field": "online", "op": "eq", "value": True},
            ],
        },
    }
    body = parse_rule_body(raw)
    assert body.condition.op == "and"
    assert len(body.condition.args) == 2
    roundtrip = body.to_dict()
    again = parse_rule_body(roundtrip)
    assert again.condition.args[1].field == "online"


def test_missing_object_fails() -> None:
    bad = {**MINIMAL, "object": ""}
    with pytest.raises(RuleDslError, match="object"):
        parse_rule_body(bad)


def test_empty_actions_fails() -> None:
    bad = {**MINIMAL, "actions": []}
    with pytest.raises(RuleDslError, match="actions"):
        parse_rule_body(bad)


def test_unknown_op_fails() -> None:
    bad = {**MINIMAL, "condition": {"field": "x", "op": "regex", "value": "a"}}
    with pytest.raises(RuleDslError, match="unknown condition op"):
        parse_rule_body(bad)


def test_unknown_action_fails() -> None:
    bad = {**MINIMAL, "actions": [{"type": "explode", "target": "x"}]}
    with pytest.raises(RuleDslError, match="unknown action type"):
        parse_rule_body(bad)


def test_schedule_requires_cron_or_every() -> None:
    bad = {**MINIMAL, "trigger": {"type": "schedule"}}
    with pytest.raises(RuleDslError, match="schedule"):
        parse_rule_body(bad)
    ok = {**MINIMAL, "trigger": {"type": "schedule", "every": "5m"}}
    assert parse_rule_body(ok).trigger["every"] == "5m"


def test_parse_from_yaml_file(tmp_path: Path) -> None:
    path = tmp_path / "rule.yaml"
    path.write_text(yaml.safe_dump(MINIMAL), encoding="utf-8")
    body = parse_rule_body(path)
    assert body.object == "device"


def test_store_round_trip_with_body(tmp_path: Path) -> None:
    body = parse_rule_body(MINIMAL)
    store = RuleFileStore(tmp_path)
    store.upsert_rule(Rule(id="dsl-1", name="Breach notify", body=body.to_dict()))
    reloaded = store.get_rule("dsl-1")
    again = parse_rule_body(reloaded.body)
    validate_rule_body(again)
    assert again.actions[0].target == "ops-channel"
