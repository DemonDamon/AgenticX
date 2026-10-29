"""Compile Rule DSL → flow / external backend plans."""

from __future__ import annotations

import pytest

from agenticx.rules.compile import (
    CompileError,
    ExternalEngineBackend,
    FlowCompileBackend,
    compile_rule,
)
from agenticx.rules.dsl import parse_rule_body
from agenticx.rules.model import Rule, RuleMeta, RuleStatus, apply_transition


def _active_rule(**kwargs) -> Rule:
    body = kwargs.pop(
        "body",
        {
            "object": "device",
            "trigger": {"type": "event", "event": "metric.breach"},
            "condition": {"field": "temperature", "op": "gt", "value": 80},
            "actions": [
                {"type": "notify", "target": "ops-channel", "params": {"level": "warn"}},
                {"type": "set_status", "params": {"status": "breached"}},
            ],
            "feedback": {"channel": "ops-channel"},
        },
    )
    parse_rule_body(body)
    rule = Rule(
        id=kwargs.pop("id", "rule-temp-1"),
        name=kwargs.pop("name", "Temp breach notify"),
        body=body,
        meta=RuleMeta(trigger="event", tags=["sample"]),
        **kwargs,
    )
    rule = apply_transition(rule, RuleStatus.PENDING)
    rule = apply_transition(rule, RuleStatus.ACTIVE)
    return rule


def test_flow_backend_maps_trigger_condition_actions() -> None:
    rule = _active_rule()
    plan = compile_rule(rule)
    assert plan.backend == "flow"
    assert plan.rule_id == "rule-temp-1"
    types = [n["type"] for n in plan.nodes]
    assert types[0] == "trigger"
    assert "condition" in types
    assert types.count("action") == 2
    assert types[-1] == "feedback"
    # Ordered: trigger → condition → actions… → feedback
    assert types.index("trigger") < types.index("condition")
    assert types.index("condition") < types.index("action")
    assert max(i for i, t in enumerate(types) if t == "action") < types.index("feedback")
    trigger_node = plan.nodes[0]
    assert trigger_node["event"] == "metric.breach"
    cond = next(n for n in plan.nodes if n["type"] == "condition")
    assert cond["field"] == "temperature"
    assert cond["op"] == "gt"
    assert cond["value"] == 80
    assert plan.meta.get("object") == "device"
    assert plan.meta.get("rule_version") == rule.version


def test_draft_and_disabled_refuse_without_force() -> None:
    draft = Rule(id="d1", name="draft", body=_active_rule().body)
    with pytest.raises(CompileError, match="active"):
        compile_rule(draft)

    active = _active_rule(id="d2")
    disabled = apply_transition(active, RuleStatus.DISABLED)
    with pytest.raises(CompileError, match="active"):
        compile_rule(disabled)

    forced = compile_rule(draft, force=True)
    assert forced.backend == "flow"
    assert forced.rule_id == "d1"


def test_invalid_body_raises() -> None:
    rule = _active_rule()
    rule.body = {"object": ""}  # invalid
    with pytest.raises(CompileError):
        compile_rule(rule)


def test_external_backend_stub_descriptor() -> None:
    rule = _active_rule()
    backend = ExternalEngineBackend(engine="sample-external-engine")
    plan = compile_rule(rule, backend=backend)
    assert plan.backend == "external"
    assert plan.meta.get("engine") == "sample-external-engine"
    assert plan.nodes  # descriptor nodes present
    assert any(n.get("type") == "external_job" for n in plan.nodes)


def test_explicit_flow_backend() -> None:
    rule = _active_rule()
    plan = compile_rule(rule, backend=FlowCompileBackend())
    assert isinstance(plan.backend, str)
    assert plan.backend == FlowCompileBackend().name
