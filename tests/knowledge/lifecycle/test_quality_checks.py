"""Quality checkers for knowledge objects."""

from __future__ import annotations

from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus, apply_transition
from agenticx.knowledge.lifecycle.quality import run_quality_checks


POLICY = {
    "required_attrs": {
        "entity": ["name"],
        "document_clause": ["title", "source_ref"],
    },
    "relation_targets_must_exist": True,
    "duplicate_keys": ["kind", "attrs.name"],
    "require_source_ids": False,
}


def test_required_attrs() -> None:
    objs = [
        KnowledgeObject(id="e1", kind="entity", attrs={}),
        KnowledgeObject(id="c1", kind="document_clause", attrs={"title": "T"}),
    ]
    findings = run_quality_checks(objs, policy=POLICY)
    codes = {(f.object_id, f.code) for f in findings}
    assert ("e1", "required_attrs") in codes
    assert ("c1", "required_attrs") in codes
    assert any("source_ref" in f.message for f in findings if f.object_id == "c1")


def test_relation_integrity_missing_target() -> None:
    objs = [
        KnowledgeObject(
            id="e1",
            kind="entity",
            attrs={"name": "A"},
            relations=[{"rel": "parent", "target_id": "missing"}],
        )
    ]
    findings = run_quality_checks(objs, policy=POLICY)
    assert any(f.code == "relation_integrity" for f in findings)


def test_duplicate_and_conflict() -> None:
    objs = [
        KnowledgeObject(id="a", kind="entity", attrs={"name": "Same"}, source_ids=["src:1"]),
        KnowledgeObject(id="b", kind="entity", attrs={"name": "Same"}, source_ids=["src:1"]),
    ]
    findings = run_quality_checks(objs, policy=POLICY)
    assert any(f.code == "duplicate" for f in findings)
    assert any(f.code == "conflict" for f in findings)


def test_stale_relation_to_retired() -> None:
    retired = KnowledgeObject(id="old", kind="entity", attrs={"name": "Old"})
    retired = apply_transition(retired, KnowledgeStatus.PENDING_REVIEW)
    retired = apply_transition(retired, KnowledgeStatus.PUBLISHED)
    retired = apply_transition(retired, KnowledgeStatus.RETIRED)
    live = KnowledgeObject(
        id="new",
        kind="entity",
        attrs={"name": "New"},
        relations=[{"rel": "replaces", "target_id": "old"}],
    )
    findings = run_quality_checks([retired, live], policy=POLICY)
    assert any(f.code == "stale" and f.object_id == "new" for f in findings)


def test_id_link_when_required() -> None:
    objs = [KnowledgeObject(id="e1", kind="entity", attrs={"name": "X"})]
    findings = run_quality_checks(objs, policy={**POLICY, "require_source_ids": True})
    assert any(f.code == "id_link" for f in findings)


def test_clean_object_no_findings() -> None:
    objs = [
        KnowledgeObject(id="e1", kind="entity", attrs={"name": "Solo"}, source_ids=["s:1"]),
        KnowledgeObject(
            id="c1",
            kind="document_clause",
            attrs={"title": "Note", "source_ref": "doc#1"},
            relations=[{"rel": "applies_to", "target_id": "e1"}],
            source_ids=["s:2"],
        ),
    ]
    assert run_quality_checks(objs, policy=POLICY) == []
