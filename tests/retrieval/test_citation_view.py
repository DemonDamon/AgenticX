"""K1-3 citation / conflict view-model snapshot."""

from __future__ import annotations

import pytest

from agenticx.retrieval.citation_view import (
    CITATION_ITEM_KEYS,
    CITATION_VIEW_KEYS,
    to_citation_view,
)
from agenticx.retrieval.evidence import (
    KIND_DOCUMENT_CLAUSE,
    KIND_LEDGER_ATTR,
    EvidenceItem,
    assemble_evidence,
)
from agenticx.retrieval.provenance import Provenance, SourceType


def _item(kind: str, source_id: str, source_type: SourceType, payload: dict, **kw) -> EvidenceItem:
    return EvidenceItem(
        kind=kind,
        payload=payload,
        provenance=Provenance(
            source_type=source_type,
            source_id=source_id,
            confidence=kw.get("confidence"),
            data_time=kw.get("data_time"),
            context_ptr=payload.get("ptr"),
        ),
    )


def test_to_citation_view_snapshot_keys() -> None:
    sources = [
        _item(
            KIND_LEDGER_ATTR,
            "table:assets",
            SourceType.STRUCTURED,
            {"attr": "status", "value": "active", "ptr": "row:1"},
            confidence=0.95,
            data_time="2026-10-20T00:00:00Z",
        ),
        _item(
            KIND_DOCUMENT_CLAUSE,
            "doc-sample-handbook",
            SourceType.DOCUMENT,
            {"attr": "status", "value": "retired", "text": "status marked retired in handbook"},
            confidence=0.6,
            data_time="2026-01-01T00:00:00Z",
        ),
    ]
    bundle = assemble_evidence(
        "entity-sample-cite-001",
        sources,
        policy={
            "group_by": "attr",
            "required_kinds": [KIND_LEDGER_ATTR, "graph_edge"],
            "required_attrs": ["status", "owner"],
        },
    )
    view = to_citation_view(bundle)

    assert tuple(view.keys()) == CITATION_VIEW_KEYS
    assert view["entity_id"] == "entity-sample-cite-001"
    assert len(view["citations"]) == 2
    cite0 = view["citations"][0]
    assert tuple(cite0.keys()) == CITATION_ITEM_KEYS
    assert cite0["label"].startswith("Ledger attribute")
    assert cite0["source_type"] == "structured"
    assert cite0["source_id"] == "table:assets"
    assert cite0["excerpt"] == "active"
    assert cite0["confidence"] == 0.95
    assert cite0["context_ptr"] == "row:1"

    assert view["citations"][1]["excerpt"].startswith("status marked retired")
    assert len(view["conflicts"]) == 1
    assert view["conflicts"][0]["identity"] == "attr:status"
    vals = {v["value"] for v in view["conflicts"][0]["values"]}
    assert vals == {"active", "retired"}
    assert "graph_edge" in view["missing"]
    assert "attr:owner" in view["missing"]
    assert isinstance(view["summary"], str) and view["summary"]


def test_to_citation_view_from_dict_and_omit_summary() -> None:
    bundle = assemble_evidence(
        "entity-sample-cite-002",
        [
            _item(
                KIND_LEDGER_ATTR,
                "table:assets",
                SourceType.STRUCTURED,
                {"attr": "owner", "value": "team-alpha"},
                confidence=0.8,
            )
        ],
    )
    view = to_citation_view(bundle.to_dict(), include_summary=False)
    assert "summary" not in view
    assert view["entity_id"] == "entity-sample-cite-002"
    assert view["citations"][0]["label"] == "Ledger attribute: owner"


def test_to_citation_view_requires_entity() -> None:
    with pytest.raises(ValueError):
        to_citation_view({"entity_id": "", "items": [], "conflicts": [], "missing": []})
