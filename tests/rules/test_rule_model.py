"""Rule entity status machine and metadata."""

from __future__ import annotations

import pytest

from agenticx.rules.model import (
    Rule,
    RuleMeta,
    RuleStatus,
    RuleTransitionError,
    apply_transition,
    can_transition,
)


def test_rule_requires_id_and_name() -> None:
    with pytest.raises(ValueError):
        Rule(id="", name="x")
    with pytest.raises(ValueError):
        Rule(id="r1", name="")


def test_meta_rejects_bad_trigger() -> None:
    with pytest.raises(ValueError):
        RuleMeta(trigger="cron")


def test_allowed_happy_path_transitions() -> None:
    r = Rule(id="threshold-1", name="Sample threshold")
    assert r.status is RuleStatus.DRAFT
    r = apply_transition(r, RuleStatus.PENDING)
    assert r.status is RuleStatus.PENDING
    r = apply_transition(r, RuleStatus.ACTIVE)
    assert r.status is RuleStatus.ACTIVE
    assert r.enabled is True
    r = apply_transition(r, RuleStatus.DISABLED)
    assert r.status is RuleStatus.DISABLED
    assert r.enabled is False
    r = apply_transition(r, RuleStatus.ARCHIVED)
    assert r.status is RuleStatus.ARCHIVED
    assert not can_transition(r.status, RuleStatus.ACTIVE)


def test_invalid_transition_raises() -> None:
    r = Rule(id="r1", name="n")
    with pytest.raises(RuleTransitionError):
        apply_transition(r, RuleStatus.ACTIVE)
    r = apply_transition(r, RuleStatus.PENDING)
    r = apply_transition(r, RuleStatus.ACTIVE)
    with pytest.raises(RuleTransitionError):
        apply_transition(r, RuleStatus.DRAFT)


def test_round_trip_dict() -> None:
    r = Rule(
        id="r2",
        name="Notify on breach",
        meta=RuleMeta(scope="workspace-a", priority=10, trigger="event", tags=["ops"]),
        body={"object": "asset"},
    )
    raw = r.to_dict()
    again = Rule.from_dict(raw)
    assert again.id == "r2"
    assert again.meta.priority == 10
    assert again.meta.trigger == "event"
    assert again.body["object"] == "asset"
    assert again.status is RuleStatus.DRAFT
