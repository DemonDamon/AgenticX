"""Closed-loop e2e: ingest → quality → issues → review → publish/retire."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.lifecycle.issues import IssueFileStore, IssueStatus
from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.quality import run_quality_checks
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.knowledge.lifecycle.trail import ChangeTrailStore


POLICY = {
    "required_attrs": {"entity": ["name"], "document_clause": ["title", "source_ref"]},
    "relation_targets_must_exist": True,
    "duplicate_keys": ["kind", "attrs.name"],
}


def test_closed_loop_publish_and_retire(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    store = KnowledgeObjectFileStore(tmp_path, trail=trail, actor="reviewer")
    issues = IssueFileStore(tmp_path)

    # 1) Ingest drafts (one incomplete → will open issue)
    store.upsert_object(
        KnowledgeObject(id="ent-1", kind="entity", attrs={"name": "Pump-A"}, source_ids=["src:1"])
    )
    store.upsert_object(
        KnowledgeObject(
            id="clause-1",
            kind="document_clause",
            attrs={"title": "Check"},  # missing source_ref
            relations=[{"rel": "applies_to", "target_id": "ent-1"}],
            source_ids=["src:2"],
        )
    )

    # 2) Quality → issues
    findings = run_quality_checks(store.list_objects(), policy=POLICY)
    assert any(f.code == "required_attrs" and f.object_id == "clause-1" for f in findings)
    opened = issues.open_from_findings(findings)
    assert opened

    # Fix object + resolve issues
    store.upsert_object(
        KnowledgeObject(
            id="clause-1",
            kind="document_clause",
            attrs={"title": "Check", "source_ref": "doc#1"},
            relations=[{"rel": "applies_to", "target_id": "ent-1"}],
            source_ids=["src:2"],
        ),
        bump_version=True,
    )
    assert run_quality_checks(store.list_objects(), policy=POLICY) == []
    for iss in issues.list_issues(status=IssueStatus.OPEN):
        issues.transition(iss.id, IssueStatus.RESOLVED, actor="reviewer")

    # 3) Review → publish
    for oid in ("ent-1", "clause-1"):
        store.transition(oid, KnowledgeStatus.PENDING_REVIEW)
        store.transition(oid, KnowledgeStatus.PUBLISHED)
        assert store.get_object(oid).status is KnowledgeStatus.PUBLISHED

    # 4) Retire one
    store.transition("clause-1", KnowledgeStatus.RETIRED)
    assert store.get_object("clause-1").status is KnowledgeStatus.RETIRED

    # 5) Trail present
    actions = [e.action for e in trail.list_for("ent-1")]
    assert "create" in actions
    assert "transition" in actions or any(a in actions for a in ("retire", "reopen", "update"))
    assert trail.list_for("clause-1")
    assert all(i.status is IssueStatus.RESOLVED for i in issues.list_issues())
