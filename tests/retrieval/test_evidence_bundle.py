"""K1-2 object-centric EvidenceBundle assembly."""

from __future__ import annotations

import pytest

from agenticx.retrieval.evidence import (
    KIND_DOCUMENT_CLAUSE,
    KIND_GRAPH_EDGE,
    KIND_LEDGER_ATTR,
    KIND_RELATED_RECORD,
    EvidenceBundle,
    EvidenceItem,
    assemble_evidence,
)
from agenticx.retrieval.provenance import Provenance, SourceType


def _item(
    kind: str,
    *,
    source_id: str,
    source_type: SourceType,
    payload: dict,
    confidence: float | None = None,
    data_time: str | None = None,
) -> EvidenceItem:
    return EvidenceItem(
        kind=kind,
        payload=payload,
        provenance=Provenance(
            source_type=source_type,
            source_id=source_id,
            confidence=confidence,
            data_time=data_time,
            context_ptr=payload.get("ptr"),
        ),
    )


def test_assemble_multi_source_sorted_by_confidence_then_time() -> None:
    sources = [
        _item(
            KIND_DOCUMENT_CLAUSE,
            source_id="doc-sample-handbook",
            source_type=SourceType.DOCUMENT,
            payload={"attr": "status", "value": "active", "text": "status is active"},
            confidence=0.55,
            data_time="2026-09-01T00:00:00Z",
        ),
        _item(
            KIND_LEDGER_ATTR,
            source_id="table:assets",
            source_type=SourceType.STRUCTURED,
            payload={"attr": "owner", "value": "team-alpha", "ptr": "row:7"},
            confidence=0.92,
            data_time="2026-10-01T00:00:00Z",
        ),
        _item(
            KIND_GRAPH_EDGE,
            source_id="edge:owns",
            source_type=SourceType.GRAPH,
            payload={"attr": "owner", "value": "team-alpha", "ptr": "n1->n2"},
            confidence=0.80,
            data_time="2026-10-15T00:00:00Z",
        ),
        _item(
            KIND_RELATED_RECORD,
            source_id="table:links",
            source_type=SourceType.STRUCTURED,
            payload={"key": "parent", "value": "entity-root", "ptr": "row:3"},
            confidence=0.80,
            data_time="2026-08-01T00:00:00Z",
        ),
    ]
    bundle = assemble_evidence("entity-sample-001", sources)
    assert isinstance(bundle, EvidenceBundle)
    assert bundle.entity_id == "entity-sample-001"
    assert len(bundle.items) == 4
    # confidence desc: 0.92, then 0.80/0.80 (newer time first among ties: Oct then Aug), then 0.55
    confs = [it.provenance.confidence for it in bundle.items]
    assert confs == [0.92, 0.80, 0.80, 0.55]
    assert bundle.items[1].provenance.data_time == "2026-10-15T00:00:00Z"
    assert bundle.items[2].provenance.data_time == "2026-08-01T00:00:00Z"
    assert "items=4" in bundle.summary
    assert bundle.missing == []
    assert bundle.conflicts == []


def test_assemble_emits_missing_required_kinds_and_attrs() -> None:
    sources = [
        _item(
            KIND_LEDGER_ATTR,
            source_id="table:assets",
            source_type=SourceType.STRUCTURED,
            payload={"attr": "owner", "value": "team-alpha"},
            confidence=0.9,
        ),
    ]
    policy = {
        "required_kinds": [KIND_LEDGER_ATTR, KIND_GRAPH_EDGE, KIND_DOCUMENT_CLAUSE],
        "required_attrs": ["owner", "status"],
    }
    bundle = assemble_evidence("entity-sample-002", sources, policy=policy)
    assert KIND_GRAPH_EDGE in bundle.missing
    assert KIND_DOCUMENT_CLAUSE in bundle.missing
    assert KIND_LEDGER_ATTR not in bundle.missing
    assert "attr:status" in bundle.missing
    assert "attr:owner" not in bundle.missing
    assert "missing=" in bundle.summary


def test_assemble_detects_value_conflicts() -> None:
    sources = [
        _item(
            KIND_LEDGER_ATTR,
            source_id="table:assets",
            source_type=SourceType.STRUCTURED,
            payload={"attr": "status", "value": "active"},
            confidence=0.95,
            data_time="2026-10-20T00:00:00Z",
        ),
        _item(
            KIND_DOCUMENT_CLAUSE,
            source_id="doc-sample-handbook",
            source_type=SourceType.DOCUMENT,
            payload={"attr": "status", "value": "retired", "text": "marked retired"},
            confidence=0.70,
            data_time="2026-01-01T00:00:00Z",
        ),
        # same value as ledger — should not alone create conflict identity across kinds
        # wait: conflict identity includes kind, so ledger vs document are different groups.
        # Add a second ledger_attr disagreeing on status.
        _item(
            KIND_LEDGER_ATTR,
            source_id="table:assets-mirror",
            source_type=SourceType.STRUCTURED,
            payload={"attr": "status", "value": "pending"},
            confidence=0.60,
            data_time="2026-09-01T00:00:00Z",
        ),
    ]
    # Cross-kind conflicts: use identity without kind prefix by customizing —
    # default groups by kind:attr:name so same-kind disagreement fires.
    bundle = assemble_evidence("entity-sample-003", sources)
    assert len(bundle.conflicts) == 1
    conflict = bundle.conflicts[0]
    assert conflict["kind"] == KIND_LEDGER_ATTR
    assert conflict["identity"] == f"{KIND_LEDGER_ATTR}:attr:status"
    vals = {v["value"] for v in conflict["values"]}
    assert vals == {"active", "pending"}
    assert "conflicts=1" in bundle.summary


def test_assemble_cross_kind_conflict_via_policy() -> None:
    """group_by=attr flattens identity so document vs ledger on same attr conflict."""
    sources = [
        _item(
            KIND_LEDGER_ATTR,
            source_id="table:assets",
            source_type=SourceType.STRUCTURED,
            payload={"attr": "status", "value": "active"},
            confidence=0.9,
        ),
        _item(
            KIND_DOCUMENT_CLAUSE,
            source_id="doc-sample-handbook",
            source_type=SourceType.DOCUMENT,
            payload={"attr": "status", "value": "retired"},
            confidence=0.5,
        ),
    ]
    # Default: kind-scoped — no conflict
    assert assemble_evidence("entity-sample-004", sources).conflicts == []

    bundle = assemble_evidence(
        "entity-sample-004",
        sources,
        policy={"group_by": "attr"},
    )
    assert len(bundle.conflicts) == 1
    vals = {v["value"] for v in bundle.conflicts[0]["values"]}
    assert vals == {"active", "retired"}
    assert bundle.conflicts[0]["identity"] == "attr:status"


def test_evidence_item_requires_kind() -> None:
    with pytest.raises(ValueError):
        EvidenceItem(kind="", payload={}, provenance=Provenance(source_type="document", source_id="x"))


def test_assemble_requires_entity_id() -> None:
    with pytest.raises(ValueError):
        assemble_evidence("", [])


def test_bundle_to_dict_round_trip_shape() -> None:
    item = _item(
        KIND_GRAPH_EDGE,
        source_id="edge:related",
        source_type=SourceType.GRAPH,
        payload={"attr": "related_to", "value": "entity-other"},
        confidence=0.77,
    )
    bundle = assemble_evidence("entity-sample-005", [item])
    raw = bundle.to_dict()
    assert raw["entity_id"] == "entity-sample-005"
    assert raw["items"][0]["kind"] == KIND_GRAPH_EDGE
    assert raw["items"][0]["provenance"]["source_type"] == "graph"
    assert raw["missing"] == []
    assert raw["conflicts"] == []
