"""Deterministic NL → rule draft pipeline (no network LLM).

Parses a small set of English templates so CI can run without API keys.
Hook points: intent classification, element extraction, ambiguity candidates,
DSL validation, and ``confirm_context`` shaped for ``runtime/confirm.py``.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from agenticx.rules.dsl import RuleDslError, parse_rule_body
from agenticx.rules.intents import RuleIntent
from agenticx.rules.model import Rule, RuleMeta, RuleStatus

_COMPARE_WORDS = {
    "greater than": "gt",
    "more than": "gt",
    "above": "gt",
    "less than": "lt",
    "below": "lt",
    "at least": "gte",
    "at most": "lte",
    "equal to": "eq",
    "equals": "eq",
}

_DEFAULT_OBJECTS = ("device", "asset", "sensor", "metric")
_DEFAULT_CHANNELS = ("ops-channel", "alerts", "oncall")


@dataclass
class NlAmbiguity:
    field: str
    candidates: List[str]
    reason: str


@dataclass
class NlRuleRequest:
    text: str
    lexicon: Optional[Dict[str, Any]] = None


@dataclass
class NlRuleDraft:
    intent: RuleIntent
    rule: Optional[Rule]
    ambiguities: List[NlAmbiguity] = field(default_factory=list)
    confirm_context: Dict[str, Any] = field(default_factory=dict)


def classify_intent(text: str) -> RuleIntent:
    t = (text or "").strip().lower()
    if t.startswith("test run") or t.startswith("testrun") or "test run rule" in t:
        return RuleIntent.TEST_RUN
    if t.startswith("modify") or t.startswith("update rule") or t.startswith("change rule"):
        return RuleIntent.MODIFY
    if t.startswith("query") or t.startswith("list rules") or t.startswith("find rules"):
        return RuleIntent.QUERY
    if t.startswith("create") or t.startswith("add rule") or t.startswith("new rule"):
        return RuleIntent.CREATE
    return RuleIntent.CREATE


def draft_rule_from_nl(
    text_or_request: Union[str, NlRuleRequest],
    *,
    lexicon: Optional[Dict[str, Any]] = None,
) -> NlRuleDraft:
    if isinstance(text_or_request, NlRuleRequest):
        text = text_or_request.text
        lexicon = text_or_request.lexicon if lexicon is None else lexicon
    else:
        text = text_or_request
    text = (text or "").strip()
    intent = classify_intent(text)
    lex = dict(lexicon or {})

    if intent is RuleIntent.QUERY:
        return NlRuleDraft(
            intent=intent,
            rule=None,
            ambiguities=[],
            confirm_context=_confirm_ctx(risk="low", reason="query_only", intent=intent.value),
        )

    if intent is RuleIntent.TEST_RUN:
        rule_id = _extract_rule_id(text) or "unknown"
        ambiguities: List[NlAmbiguity] = []
        if rule_id == "unknown":
            ambiguities.append(
                NlAmbiguity(
                    field="rule_id",
                    candidates=[],
                    reason="test run requires an existing rule id",
                )
            )
        return NlRuleDraft(
            intent=intent,
            rule=None,
            ambiguities=ambiguities,
            confirm_context=_confirm_ctx(
                risk="policy",
                reason="test_run",
                intent=intent.value,
                rule_id=rule_id,
            ),
        )

    if intent is RuleIntent.MODIFY:
        return _draft_modify(text, lex)

    return _draft_create(text, lex)


def _confirm_ctx(*, risk: str, reason: str, **extra: Any) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {"risk": risk, "reason": reason, "source": "rules.nl"}
    ctx.update(extra)
    return ctx


def _extract_rule_id(text: str) -> Optional[str]:
    m = re.search(r"\brule\s+([A-Za-z0-9_.:-]+)", text, flags=re.I)
    if m:
        return m.group(1)
    return None


def _draft_modify(text: str, lex: Dict[str, Any]) -> NlRuleDraft:
    rule_id = _extract_rule_id(text)
    ambiguities: List[NlAmbiguity] = []
    if not rule_id:
        ambiguities.append(
            NlAmbiguity(
                field="rule_id",
                candidates=[],
                reason="modify requires a target rule id",
            )
        )
    threshold = _extract_number(text)
    field_name = _extract_metric_field(text)
    if threshold is None:
        ambiguities.append(
            NlAmbiguity(
                field="threshold",
                candidates=["80", "90", "100"],
                reason="modify text missing numeric threshold",
            )
        )
    if ambiguities:
        return NlRuleDraft(
            intent=RuleIntent.MODIFY,
            rule=None,
            ambiguities=ambiguities,
            confirm_context=_confirm_ctx(
                risk="policy",
                reason="ambiguity",
                intent=RuleIntent.MODIFY.value,
            ),
        )
    obj = _pick_object(text, lex) or "device"
    body = {
        "object": obj,
        "trigger": {"type": "event", "event": "metric.breach"},
        "condition": {
            "field": field_name or "temperature",
            "op": _extract_compare_op(text) or "gt",
            "value": threshold,
        },
        "actions": [{"type": "notify", "target": "ops-channel", "params": {}}],
        "feedback": {"channel": "ops-channel"},
    }
    try:
        parse_rule_body(body)
    except RuleDslError as exc:
        return NlRuleDraft(
            intent=RuleIntent.MODIFY,
            rule=None,
            ambiguities=[NlAmbiguity(field="body", candidates=[], reason=str(exc))],
            confirm_context=_confirm_ctx(
                risk="policy",
                reason="validation_failed",
                intent=RuleIntent.MODIFY.value,
            ),
        )
    rule = Rule(
        id=rule_id or f"rule-{uuid.uuid4().hex[:8]}",
        name=f"Modified {rule_id}",
        status=RuleStatus.DRAFT,
        body=body,
        meta=RuleMeta(trigger="event", tags=["nl-draft", "modify"]),
    )
    return NlRuleDraft(
        intent=RuleIntent.MODIFY,
        rule=rule,
        ambiguities=[],
        confirm_context=_confirm_ctx(
            risk="policy",
            reason="rule_ingest",
            intent=RuleIntent.MODIFY.value,
        ),
    )


def _draft_create(text: str, lex: Dict[str, Any]) -> NlRuleDraft:
    ambiguities: List[NlAmbiguity] = []
    objects = [str(x) for x in (lex.get("objects") or list(_DEFAULT_OBJECTS))]
    channels = [str(x) for x in (lex.get("channels") or list(_DEFAULT_CHANNELS))]

    obj = _pick_object(text, lex)
    if not obj:
        ambiguities.append(
            NlAmbiguity(
                field="object",
                candidates=objects,
                reason="could not resolve data object from NL; pick a candidate",
            )
        )

    field_name = _extract_metric_field(text)
    if not field_name:
        ambiguities.append(
            NlAmbiguity(
                field="condition.field",
                candidates=["temperature", "pressure", "latency"],
                reason="metric field not found in NL",
            )
        )

    op = _extract_compare_op(text)
    threshold = _extract_number(text)
    if threshold is None:
        if re.search(r"\b(high|low|critical|elevated)\b", text, flags=re.I):
            ambiguities.append(
                NlAmbiguity(
                    field="threshold",
                    candidates=["60", "80", "90", "100"],
                    reason="qualitative threshold needs a numeric value",
                )
            )
        else:
            ambiguities.append(
                NlAmbiguity(
                    field="threshold",
                    candidates=["60", "80", "90"],
                    reason="numeric threshold missing",
                )
            )

    if not op and threshold is not None:
        op = "gt"

    action_target = _extract_notify_target(text, channels)
    if not action_target:
        ambiguities.append(
            NlAmbiguity(
                field="action.target",
                candidates=channels,
                reason="notify target channel not found",
            )
        )

    if ambiguities:
        return NlRuleDraft(
            intent=RuleIntent.CREATE,
            rule=None,
            ambiguities=ambiguities,
            confirm_context=_confirm_ctx(
                risk="policy",
                reason="ambiguity",
                intent=RuleIntent.CREATE.value,
            ),
        )

    body = {
        "object": obj,
        "trigger": {"type": "event", "event": "metric.breach"},
        "condition": {"field": field_name, "op": op or "gt", "value": threshold},
        "actions": [
            {
                "type": "notify",
                "target": action_target,
                "params": {"level": "warn"},
            }
        ],
        "feedback": {"channel": action_target},
    }
    try:
        parse_rule_body(body)
    except RuleDslError as exc:
        return NlRuleDraft(
            intent=RuleIntent.CREATE,
            rule=None,
            ambiguities=[NlAmbiguity(field="body", candidates=[], reason=str(exc))],
            confirm_context=_confirm_ctx(
                risk="policy",
                reason="validation_failed",
                intent=RuleIntent.CREATE.value,
            ),
        )

    slug = re.sub(r"[^a-z0-9]+", "-", (field_name or "metric").lower()).strip("-")
    rule = Rule(
        id=f"nl-{slug}-{uuid.uuid4().hex[:6]}",
        name=f"NL draft: {obj} {field_name} {op} {threshold}",
        status=RuleStatus.DRAFT,
        body=body,
        meta=RuleMeta(trigger="event", tags=["nl-draft", "create"]),
    )
    return NlRuleDraft(
        intent=RuleIntent.CREATE,
        rule=rule,
        ambiguities=[],
        confirm_context=_confirm_ctx(
            risk="policy",
            reason="rule_ingest",
            intent=RuleIntent.CREATE.value,
        ),
    )


def _pick_object(text: str, lex: Dict[str, Any]) -> Optional[str]:
    objects = [str(x) for x in (lex.get("objects") or list(_DEFAULT_OBJECTS))]
    lower = text.lower()
    for name in objects:
        if re.search(rf"\b{re.escape(name.lower())}\b", lower):
            return name
    m = re.search(r"\bwhen\s+([a-z][a-z0-9_-]*)\s+([a-z][a-z0-9_-]*)\b", lower)
    if m and m.group(1) in {o.lower() for o in objects}:
        for name in objects:
            if name.lower() == m.group(1):
                return name
    return None


def _extract_metric_field(text: str) -> Optional[str]:
    lower = text.lower()
    m = re.search(
        r"\b(?:device|asset|sensor|metric)?\s*(temperature|pressure|latency|cpu|memory)\b",
        lower,
    )
    if m:
        return m.group(1)
    m = re.search(r"\bwhen\s+[a-z0-9_-]+\s+([a-z][a-z0-9_-]*)\b", lower)
    if m and m.group(1) not in {"is", "are", "the", "a"}:
        return m.group(1)
    return None


def _extract_compare_op(text: str) -> Optional[str]:
    lower = text.lower()
    for phrase, op in sorted(_COMPARE_WORDS.items(), key=lambda kv: -len(kv[0])):
        if phrase in lower:
            return op
    if ">" in text:
        return "gt"
    if "<" in text:
        return "lt"
    return None


def _extract_number(text: str) -> Optional[float]:
    m = re.search(
        r"(?:greater than|more than|above|less than|below|at least|at most|equal to|equals|>|<)\s*([-+]?\d+(?:\.\d+)?)",
        text,
        flags=re.I,
    )
    if m:
        return _num(m.group(1))
    m = re.search(r"\b(?:threshold|value)\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)", text, flags=re.I)
    if m:
        return _num(m.group(1))
    return None


def _num(raw: str) -> float | int:
    if "." in raw:
        return float(raw)
    return int(raw)


def _extract_notify_target(text: str, channels: List[str]) -> Optional[str]:
    lower = text.lower()
    m = re.search(r"\bnotify\s+([a-z0-9_.:-]+)", lower)
    if m:
        token = m.group(1)
        for ch in channels:
            if ch.lower() == token:
                return ch
        return token
    for ch in channels:
        if ch.lower() in lower:
            return ch
    return None
