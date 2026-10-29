"""Issue list store + handling transitions."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.knowledge.lifecycle.issues import (
    IssueFileStore,
    IssueStatus,
    IssueTransitionError,
    KnowledgeIssue,
)
from agenticx.knowledge.lifecycle.quality import QualityFinding, run_quality_checks
from agenticx.knowledge.lifecycle.model import KnowledgeObject


def test_open_from_findings_and_dedup(tmp_path: Path) -> None:
    store = IssueFileStore(tmp_path)
    findings = [
        QualityFinding(code="required_attrs", severity="error", object_id="e1", message="missing name"),
        QualityFinding(code="required_attrs", severity="error", object_id="e1", message="missing name"),
    ]
    created = store.open_from_findings(findings)
    assert len(created) == 1
    again = store.open_from_findings(findings)
    assert again == []
    assert len(store.list_issues(status=IssueStatus.OPEN)) == 1


def test_transition_resolve_waive(tmp_path: Path) -> None:
    store = IssueFileStore(tmp_path)
    store.open_from_findings(
        [QualityFinding(code="duplicate", severity="warning", object_id="a", message="dup")]
    )
    issue = store.list_issues()[0]
    store.transition(issue.id, IssueStatus.IN_PROGRESS, actor="ops")
    done = store.transition(issue.id, IssueStatus.RESOLVED, actor="ops")
    assert done.status is IssueStatus.RESOLVED
    assert done.resolved_by == "ops"
    with pytest.raises(IssueTransitionError):
        store.transition(issue.id, IssueStatus.WAIVED)


def test_list_filters(tmp_path: Path) -> None:
    store = IssueFileStore(tmp_path)
    store.open_from_findings(
        [
            QualityFinding(code="conflict", severity="error", object_id="a", message="c1"),
            QualityFinding(code="stale", severity="warning", object_id="b", message="s1"),
        ]
    )
    assert len(store.list_issues(object_id="a")) == 1
    issue = store.list_issues(object_id="b")[0]
    store.transition(issue.id, IssueStatus.WAIVED, actor="qa")
    assert store.list_issues(status=IssueStatus.WAIVED)[0].object_id == "b"


def test_integration_with_quality(tmp_path: Path) -> None:
    objs = [KnowledgeObject(id="e1", kind="entity", attrs={})]
    findings = run_quality_checks(objs, policy={"required_attrs": {"entity": ["name"]}})
    store = IssueFileStore(tmp_path)
    opened = store.open_from_findings(findings)
    assert opened and opened[0].code == "required_attrs"
