"""KnowledgeObject status machine and validation."""

from __future__ import annotations

import pytest

from agenticx.knowledge.lifecycle.model import (
    KnowledgeObject,
    KnowledgeStatus,
    KnowledgeTransitionError,
    apply_transition,
    can_transition,
)


def test_object_requires_id_and_kind() -> None:
    with pytest.raises(ValueError):
        KnowledgeObject(id="", kind="entity")
    with pytest.raises(ValueError):
        KnowledgeObject(id="o1", kind="")


def test_allowed_happy_path_transitions() -> None:
    o = KnowledgeObject(id="ent-1", kind="entity", attrs={"name": "Sample"})
    assert o.status is KnowledgeStatus.DRAFT
    o = apply_transition(o, KnowledgeStatus.PENDING_REVIEW)
    assert o.status is KnowledgeStatus.PENDING_REVIEW
    o = apply_transition(o, KnowledgeStatus.PUBLISHED)
    assert o.status is KnowledgeStatus.PUBLISHED
    o = apply_transition(o, KnowledgeStatus.RETIRED)
    assert o.status is KnowledgeStatus.RETIRED
    assert can_transition(o.status, KnowledgeStatus.DRAFT)
    o = apply_transition(o, KnowledgeStatus.DRAFT)
    assert o.status is KnowledgeStatus.DRAFT


def test_reject_back_to_draft_from_pending() -> None:
    o = KnowledgeObject(id="o1", kind="entity")
    o = apply_transition(o, KnowledgeStatus.PENDING_REVIEW)
    o = apply_transition(o, KnowledgeStatus.DRAFT)
    assert o.status is KnowledgeStatus.DRAFT


def test_invalid_transition_raises() -> None:
    o = KnowledgeObject(id="o1", kind="entity")
    with pytest.raises(KnowledgeTransitionError):
        apply_transition(o, KnowledgeStatus.PUBLISHED)
    o = apply_transition(o, KnowledgeStatus.PENDING_REVIEW)
    o = apply_transition(o, KnowledgeStatus.PUBLISHED)
    with pytest.raises(KnowledgeTransitionError):
        apply_transition(o, KnowledgeStatus.PENDING_REVIEW)


def test_round_trip_dict() -> None:
    o = KnowledgeObject(
        id="clause-1",
        kind="document_clause",
        attrs={"title": "Safety note", "source_ref": "doc-a#3"},
        relations=[{"rel": "applies_to", "target_id": "ent-1"}],
        source_ids=["src:a", "src:b"],
        meta={"owner": "workspace-a"},
    )
    raw = o.to_dict()
    again = KnowledgeObject.from_dict(raw)
    assert again.id == "clause-1"
    assert again.kind == "document_clause"
    assert again.attrs["title"] == "Safety note"
    assert again.relations[0]["target_id"] == "ent-1"
    assert again.source_ids == ["src:a", "src:b"]
    assert again.status is KnowledgeStatus.DRAFT
    assert again.version == 1
