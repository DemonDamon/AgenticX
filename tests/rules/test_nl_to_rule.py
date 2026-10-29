"""NL → rule draft pipeline (deterministic stub, no LLM)."""

from __future__ import annotations

import pytest

from agenticx.runtime.confirm import is_protected_confirm, normalize_confirm_risk
from agenticx.rules.dsl import parse_rule_body, validate_rule_body
from agenticx.rules.intents import RuleIntent
from agenticx.rules.nl import NlAmbiguity, NlRuleDraft, NlRuleRequest, draft_rule_from_nl


CREATE_COMPLETE = (
    "Create a rule: when device temperature is greater than 80 "
    "then notify ops-channel"
)

CREATE_MISSING_OBJECT = (
    "Create a rule: when temperature is greater than 80 then notify ops-channel"
)

CREATE_MISSING_THRESHOLD = (
    "Create a rule: when device temperature is high then notify ops-channel"
)

MODIFY_TEXT = "Modify rule threshold-1: set temperature greater than 90"
QUERY_TEXT = "Query rules for device temperature alerts"
TEST_RUN_TEXT = "Test run rule threshold-1"


def test_create_complete_yields_validated_rule() -> None:
    draft = draft_rule_from_nl(CREATE_COMPLETE)
    assert draft.intent is RuleIntent.CREATE
    assert draft.rule is not None
    assert draft.ambiguities == []
    assert draft.rule.status.value == "draft"
    assert draft.rule.body["object"] == "device"
    body = parse_rule_body(draft.rule.body)
    validate_rule_body(body)
    assert body.condition.field == "temperature"
    assert body.condition.op == "gt"
    assert body.condition.value == 80
    assert body.actions[0].type == "notify"
    assert body.actions[0].target == "ops-channel"
    # Complete drafts still go through confirm gate (policy ingest).
    assert draft.confirm_context.get("risk") == "policy"
    assert is_protected_confirm(draft.confirm_context)


def test_missing_object_produces_ambiguity_candidates() -> None:
    lexicon = {"objects": ["device", "asset", "sensor"]}
    draft = draft_rule_from_nl(CREATE_MISSING_OBJECT, lexicon=lexicon)
    assert draft.intent is RuleIntent.CREATE
    assert draft.rule is None
    fields = {a.field: a for a in draft.ambiguities}
    assert "object" in fields
    assert fields["object"].candidates == ["device", "asset", "sensor"]
    assert fields["object"].reason
    assert draft.confirm_context.get("risk") == "policy"
    assert normalize_confirm_risk(draft.confirm_context) != "low"


def test_missing_threshold_produces_ambiguity() -> None:
    draft = draft_rule_from_nl(CREATE_MISSING_THRESHOLD)
    assert draft.rule is None
    fields = {a.field for a in draft.ambiguities}
    assert "threshold" in fields or "condition.value" in fields
    assert is_protected_confirm(draft.confirm_context)


def test_modify_query_test_intents() -> None:
    assert draft_rule_from_nl(MODIFY_TEXT).intent is RuleIntent.MODIFY
    assert draft_rule_from_nl(QUERY_TEXT).intent is RuleIntent.QUERY
    assert draft_rule_from_nl(TEST_RUN_TEXT).intent is RuleIntent.TEST_RUN


def test_request_wrapper_matches_text_path() -> None:
    req = NlRuleRequest(text=CREATE_COMPLETE, lexicon={"objects": ["device"]})
    draft = draft_rule_from_nl(req)
    assert isinstance(draft, NlRuleDraft)
    assert draft.rule is not None
    assert draft.rule.meta.tags  # synthetic tag from pipeline


def test_invalid_body_never_returned_as_rule() -> None:
    # Force a path that cannot assemble a valid body → ambiguities, no rule.
    draft = draft_rule_from_nl("Create a rule about something vague")
    assert draft.intent is RuleIntent.CREATE
    assert draft.rule is None
    assert draft.ambiguities
    assert all(isinstance(a, NlAmbiguity) for a in draft.ambiguities)
