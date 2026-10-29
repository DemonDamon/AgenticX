"""K1-1 provenance on RetrievalResult."""

from __future__ import annotations

from dataclasses import asdict

import pytest

from agenticx.retrieval.base import RetrievalResult
from agenticx.retrieval.provenance import (
    Provenance,
    SourceType,
    attach_provenance,
    provenance_from_legacy,
)


def test_provenance_round_trip_dict() -> None:
    p = Provenance(
        source_type=SourceType.DOCUMENT,
        source_id="doc-sample-handbook",
        data_time="2026-10-01T00:00:00Z",
        confidence=0.91,
        context_ptr="chunk:12",
    )
    raw = p.to_dict()
    again = Provenance.from_dict(raw)
    assert again is not None
    assert again.source_type is SourceType.DOCUMENT
    assert again.source_id == "doc-sample-handbook"
    assert again.context_ptr == "chunk:12"
    assert again.confidence == 0.91


def test_retrieval_result_optional_provenance_default_none() -> None:
    # Backward compatible: existing positional construction still works
    r = RetrievalResult(content="hello", score=0.5)
    assert r.provenance is None
    assert r.source is None


def test_attach_and_with_provenance() -> None:
    r = RetrievalResult(content="ledger row", score=0.8, source="table:assets")
    p = Provenance(
        source_type="structured",
        source_id="table:assets",
        confidence=0.7,
        context_ptr="row:42",
    )
    attached = attach_provenance(r, p)
    assert attached.provenance is not None
    assert attached.provenance.source_type is SourceType.STRUCTURED
    # original unchanged
    assert r.provenance is None

    via_method = r.with_provenance(
        {
            "source_type": "graph",
            "source_id": "edge:owns",
            "confidence": 0.6,
            "context_ptr": "n1->n2",
        }
    )
    assert via_method.provenance is not None
    assert via_method.provenance.source_type is SourceType.GRAPH


def test_ensure_provenance_from_legacy_fields() -> None:
    r = RetrievalResult(content="clause", score=0.4, source="doc-a", chunk_id="c-9")
    filled = r.ensure_provenance()
    assert filled.provenance is not None
    assert filled.provenance.source_id == "doc-a"
    assert filled.provenance.context_ptr == "c-9"
    assert filled.provenance.source_type is SourceType.DOCUMENT

    # already set — no overwrite
    custom = Provenance(source_type=SourceType.INFERENCE, source_id="summary-1", confidence=0.5)
    locked = attach_provenance(r, custom).ensure_provenance()
    assert locked.provenance is not None
    assert locked.provenance.source_id == "summary-1"


def test_provenance_from_legacy_empty() -> None:
    assert provenance_from_legacy() is None


def test_confidence_bounds() -> None:
    with pytest.raises(ValueError):
        Provenance(source_type=SourceType.DOCUMENT, source_id="x", confidence=1.5)
    with pytest.raises(ValueError):
        Provenance(source_type=SourceType.DOCUMENT, source_id="")
