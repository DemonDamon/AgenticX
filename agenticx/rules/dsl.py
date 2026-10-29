"""Declarative rule DSL: object → trigger → condition → actions → feedback."""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from pathlib import Path
from typing import Any, Dict, List, Union

import yaml

LEAF_OPS = frozenset({"eq", "ne", "gt", "gte", "lt", "lte", "in", "exists"})
BOOL_OPS = frozenset({"and", "or", "not"})
ALLOWED_OPS = LEAF_OPS | BOOL_OPS
ALLOWED_ACTION_TYPES = frozenset({"notify", "invoke", "set_status", "emit_event"})
ALLOWED_TRIGGER_TYPES = frozenset({"manual", "schedule", "event"})


class RuleDslError(ValueError):
    """Invalid rule DSL payload."""


@dataclass
class Condition:
    field: str = ""
    op: str = "eq"
    value: Any = None
    args: List["Condition"] = dc_field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"op": self.op}
        if self.op in BOOL_OPS:
            out["args"] = [a.to_dict() for a in self.args]
            return out
        out["field"] = self.field
        if self.op != "exists":
            out["value"] = self.value
        return out

    @classmethod
    def from_dict(cls, raw: Any) -> "Condition":
        if not isinstance(raw, dict):
            raise RuleDslError("condition must be a mapping")
        op = str(raw.get("op") or "eq").strip().lower()
        if op not in ALLOWED_OPS:
            raise RuleDslError(f"unknown condition op: {op!r}")
        if op in BOOL_OPS:
            args_raw = raw.get("args")
            if not isinstance(args_raw, list):
                raise RuleDslError(f"{op} expects args list")
            if op == "not" and len(args_raw) != 1:
                raise RuleDslError("not expects exactly one arg")
            if op in {"and", "or"} and len(args_raw) < 1:
                raise RuleDslError(f"{op} expects at least one arg")
            return cls(op=op, args=[cls.from_dict(a) for a in args_raw])
        field_name = str(raw.get("field") or "").strip()
        if not field_name:
            raise RuleDslError("leaf condition.field is required")
        return cls(field=field_name, op=op, value=raw.get("value"))


@dataclass
class Action:
    type: str
    target: str = ""
    params: Dict[str, Any] = dc_field(default_factory=dict)

    def __post_init__(self) -> None:
        self.type = str(self.type or "").strip().lower()
        self.target = str(self.target or "")
        self.params = dict(self.params or {})

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "target": self.target, "params": dict(self.params)}

    @classmethod
    def from_dict(cls, raw: Any) -> "Action":
        if not isinstance(raw, dict):
            raise RuleDslError("action must be a mapping")
        atype = str(raw.get("type") or "").strip().lower()
        if not atype:
            raise RuleDslError("action.type is required")
        if atype not in ALLOWED_ACTION_TYPES:
            raise RuleDslError(f"unknown action type: {atype!r}")
        return cls(
            type=atype,
            target=str(raw.get("target") or ""),
            params=dict(raw.get("params") or {}),
        )


@dataclass
class RuleBody:
    object: str
    trigger: Dict[str, Any]
    condition: Condition
    actions: List[Action]
    feedback: Dict[str, Any] = dc_field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "object": self.object,
            "trigger": dict(self.trigger),
            "condition": self.condition.to_dict(),
            "actions": [a.to_dict() for a in self.actions],
            "feedback": dict(self.feedback),
        }


def _load_mapping(raw: Union[Dict[str, Any], str, Path]) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, Path):
        data = yaml.safe_load(raw.read_text(encoding="utf-8"))
    elif isinstance(raw, str):
        maybe = Path(raw)
        if "\n" not in raw and maybe.is_file():
            data = yaml.safe_load(maybe.read_text(encoding="utf-8"))
        else:
            data = yaml.safe_load(raw)
    else:
        raise RuleDslError("rule body must be a mapping, YAML string, or path")
    if not isinstance(data, dict):
        raise RuleDslError("rule body root must be a mapping")
    return data


def parse_rule_body(raw: Union[Dict[str, Any], str, Path]) -> RuleBody:
    data = _load_mapping(raw)
    obj = str(data.get("object") or "").strip()
    if not obj:
        raise RuleDslError("object is required")

    trigger = data.get("trigger")
    if trigger is None:
        trigger = {"type": "manual"}
    if isinstance(trigger, str):
        trigger = {"type": trigger}
    if not isinstance(trigger, dict):
        raise RuleDslError("trigger must be a mapping or string")
    trigger = dict(trigger)
    ttype = str(trigger.get("type") or "manual").strip().lower() or "manual"
    trigger["type"] = ttype

    cond_raw = data.get("condition")
    if cond_raw is None:
        raise RuleDslError("condition is required")
    condition = Condition.from_dict(cond_raw)

    actions_raw = data.get("actions")
    if not isinstance(actions_raw, list) or not actions_raw:
        raise RuleDslError("actions must be a non-empty list")
    actions = [Action.from_dict(a) for a in actions_raw]

    feedback = data.get("feedback") or {}
    if not isinstance(feedback, dict):
        raise RuleDslError("feedback must be a mapping")

    body = RuleBody(
        object=obj,
        trigger=trigger,
        condition=condition,
        actions=actions,
        feedback=dict(feedback),
    )
    validate_rule_body(body)
    return body


def validate_rule_body(body: RuleBody) -> None:
    if not body.object or not str(body.object).strip():
        raise RuleDslError("object is required")
    ttype = str((body.trigger or {}).get("type") or "").strip().lower()
    if ttype not in ALLOWED_TRIGGER_TYPES:
        raise RuleDslError(f"unknown trigger type: {ttype!r}")
    if ttype == "schedule":
        cron = str((body.trigger or {}).get("cron") or "").strip()
        every = str((body.trigger or {}).get("every") or "").strip()
        if not cron and not every:
            raise RuleDslError("schedule trigger requires cron or every")
    if ttype == "event" and not str((body.trigger or {}).get("event") or "").strip():
        raise RuleDslError("event trigger requires event name")
    _validate_condition(body.condition)
    if not body.actions:
        raise RuleDslError("actions must be a non-empty list")
    for action in body.actions:
        if action.type not in ALLOWED_ACTION_TYPES:
            raise RuleDslError(f"unknown action type: {action.type!r}")
        if action.type in {"notify", "invoke", "emit_event"} and not action.target.strip():
            raise RuleDslError(f"action type {action.type!r} requires target")


def _validate_condition(cond: Condition) -> None:
    if cond.op not in ALLOWED_OPS:
        raise RuleDslError(f"unknown condition op: {cond.op!r}")
    if cond.op in BOOL_OPS:
        if cond.op == "not" and len(cond.args) != 1:
            raise RuleDslError("not expects exactly one arg")
        if cond.op in {"and", "or"} and len(cond.args) < 1:
            raise RuleDslError(f"{cond.op} expects at least one arg")
        for child in cond.args:
            _validate_condition(child)
        return
    if not cond.field.strip():
        raise RuleDslError("leaf condition.field is required")
