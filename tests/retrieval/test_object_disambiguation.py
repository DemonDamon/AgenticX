"""R2-4: retrieval object hits use shared disambiguation protocol."""

from __future__ import annotations

import pytest

from agenticx.runtime.disambiguation import (
    DisambiguationFileStore,
    DisambiguationMode,
    DisambiguationResponse,
    SyncDisambiguationGate,
)
from agenticx.retrieval.disambiguation import (
    ObjectHit,
    attribute_conflicts_to_request,
    needs_object_disambiguation,
    object_hits_to_request,
    resolve_attribute_conflict,
    resolve_object_hits,
)


def test_single_hit_no_disambiguation() -> None:
    hits = [ObjectHit(id="o1", label="Pump A", score=0.95)]
    assert needs_object_disambiguation(hits) is False


def test_near_score_hits_need_disambiguation() -> None:
    hits = [
        ObjectHit(id="o1", label="Pump A", score=0.91),
        ObjectHit(id="o2", label="Pump B", score=0.90),
    ]
    assert needs_object_disambiguation(hits, score_margin=0.05) is True
    req = object_hits_to_request(hits)
    assert req.mode is DisambiguationMode.CANDIDATE_SELECT
    assert [c.id for c in req.candidates] == ["o1", "o2"]


def test_clear_score_gap_no_disambiguation() -> None:
    hits = [
        ObjectHit(id="o1", label="Pump A", score=0.95),
        ObjectHit(id="o2", label="Pump B", score=0.40),
    ]
    assert needs_object_disambiguation(hits, score_margin=0.05) is False


def test_conflict_resolve_request() -> None:
    req = attribute_conflicts_to_request(
        "status",
        {"ledger": "online", "sensor": "offline"},
    )
    assert req.mode is DisambiguationMode.CONFLICT_RESOLVE
    assert len(req.conflicts) == 1
    assert req.conflicts[0].values == ["online", "offline"]
    resp = DisambiguationResponse(
        request_id=req.id, selected_ids=["ledger::online"]
    )
    assert resolve_attribute_conflict("status", {"ledger": "online", "sensor": "offline"}, resp) == "online"


@pytest.mark.asyncio
async def test_resolve_object_hits_via_gate(tmp_path) -> None:
    hits = [
        ObjectHit(id="o1", label="Unit-1", score=0.88, sources=["graph"]),
        ObjectHit(id="o2", label="Unit-2", score=0.87, sources=["ledger"]),
    ]
    store = DisambiguationFileStore(tmp_path)

    def resolver(req):
        return DisambiguationResponse(request_id=req.id, selected_ids=["o2"])

    gate = SyncDisambiguationGate(resolver=resolver)
    chosen, session = await resolve_object_hits(hits, gate=gate, store=store)
    assert chosen is not None
    assert chosen.id == "o2"
    assert session is not None
    assert session.source == "retrieval.object"
    assert session.status.value == "completed"


@pytest.mark.asyncio
async def test_clear_hit_skips_session() -> None:
    hits = [
        ObjectHit(id="o1", label="Unit-1", score=0.95),
        ObjectHit(id="o2", label="Unit-2", score=0.20),
    ]
    chosen, session = await resolve_object_hits(hits)
    assert chosen is not None
    assert chosen.id == "o1"
    assert session is None
