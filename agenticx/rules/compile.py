"""Compile a Rule (DSL body) into an executable plan.

Default backend targets AGX Flow / workflow_engine-friendly ordered nodes.
External engines plug in via ``CompileBackend`` (stub included).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from agenticx.rules.dsl import Action, Condition, RuleBody, RuleDslError, parse_rule_body
from agenticx.rules.model import Rule, RuleStatus


class CompileError(ValueError):
    """Rule cannot be compiled."""


@dataclass
class CompiledPlan:
    backend: str
    rule_id: str
    nodes: List[Dict[str, Any]]
    meta: Dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class CompileBackend(Protocol):
    name: str

    def compile(self, rule: Rule) -> CompiledPlan: ...


def compile_rule(
    rule: Rule,
    backend: Optional[CompileBackend] = None,
    *,
    force: bool = False,
) -> CompiledPlan:
    """Compile ``rule`` with the given backend (default: Flow).

    Non-active rules raise ``CompileError`` unless ``force=True``.
    """
    if not isinstance(rule, Rule):
        raise TypeError("rule must be a Rule")
    if rule.status is not RuleStatus.ACTIVE and not force:
        raise CompileError(
            f"refuse to compile rule {rule.id!r}: status is {rule.status.value}, expected active "
            "(pass force=True to override)"
        )
    try:
        body = parse_rule_body(rule.body)
    except RuleDslError as exc:
        raise CompileError(f"invalid rule body for {rule.id!r}: {exc}") from exc

    impl = backend or FlowCompileBackend()
    plan = impl.compile(rule)
    # Ensure body-derived meta is present even if backend omits it.
    plan.meta.setdefault("object", body.object)
    plan.meta.setdefault("rule_version", rule.version)
    plan.meta.setdefault("rule_status", rule.status.value)
    return plan


class FlowCompileBackend:
    """Map RuleBody → ordered flow-style nodes for workflow_engine / Flow."""

    name = "flow"

    def compile(self, rule: Rule) -> CompiledPlan:
        body = parse_rule_body(rule.body)
        nodes: List[Dict[str, Any]] = []
        nodes.append(_trigger_node(body))
        nodes.append(_condition_node(body.condition, node_id="condition"))
        for i, action in enumerate(body.actions):
            nodes.append(_action_node(action, node_id=f"action-{i}"))
        nodes.append(_feedback_node(body))
        return CompiledPlan(
            backend=self.name,
            rule_id=rule.id,
            nodes=nodes,
            meta={
                "object": body.object,
                "rule_version": rule.version,
                "rule_status": rule.status.value,
                "target": "agenticx.flow / workflow_engine",
            },
        )


class ExternalEngineBackend:
    """Plugin stub: emit an external-job descriptor instead of Flow nodes."""

    name = "external"

    def __init__(self, engine: str = "external") -> None:
        self.engine = str(engine or "external")

    def compile(self, rule: Rule) -> CompiledPlan:
        body = parse_rule_body(rule.body)
        descriptor = {
            "type": "external_job",
            "id": f"ext-{rule.id}",
            "engine": self.engine,
            "payload": {
                "rule_id": rule.id,
                "object": body.object,
                "trigger": dict(body.trigger),
                "condition": body.condition.to_dict(),
                "actions": [a.to_dict() for a in body.actions],
                "feedback": dict(body.feedback),
            },
        }
        return CompiledPlan(
            backend=self.name,
            rule_id=rule.id,
            nodes=[descriptor],
            meta={
                "engine": self.engine,
                "object": body.object,
                "rule_version": rule.version,
                "rule_status": rule.status.value,
                "note": "stub — wire to customer engine adapter in B-layer",
            },
        )


def _trigger_node(body: RuleBody) -> Dict[str, Any]:
    trigger = dict(body.trigger)
    ttype = str(trigger.get("type") or "manual")
    node: Dict[str, Any] = {
        "id": "trigger",
        "type": "trigger",
        "trigger_type": ttype,
    }
    if ttype == "event":
        node["event"] = trigger.get("event")
    elif ttype == "schedule":
        if trigger.get("cron"):
            node["cron"] = trigger.get("cron")
        if trigger.get("every"):
            node["every"] = trigger.get("every")
    return node


def _condition_node(cond: Condition, *, node_id: str) -> Dict[str, Any]:
    node: Dict[str, Any] = {
        "id": node_id,
        "type": "condition",
        "op": cond.op,
    }
    if cond.op in {"and", "or", "not"}:
        node["args"] = [
            _condition_node(child, node_id=f"{node_id}-{i}")
            for i, child in enumerate(cond.args)
        ]
    else:
        node["field"] = cond.field
        if cond.op != "exists":
            node["value"] = cond.value
    return node


def _action_node(action: Action, *, node_id: str) -> Dict[str, Any]:
    return {
        "id": node_id,
        "type": "action",
        "action_type": action.type,
        "target": action.target,
        "params": dict(action.params),
    }


def _feedback_node(body: RuleBody) -> Dict[str, Any]:
    return {
        "id": "feedback",
        "type": "feedback",
        "channel": (body.feedback or {}).get("channel"),
        "feedback": dict(body.feedback or {}),
    }
