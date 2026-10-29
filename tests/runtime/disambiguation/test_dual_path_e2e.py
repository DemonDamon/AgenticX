"""R2-5: rules NL and retrieval object paths share one protocol."""

from __future__ import annotations

import pytest

from agenticx.runtime.disambiguation import (
    DisambiguationFileStore,
    DisambiguationMode,
    DisambiguationResponse,
    SyncDisambiguationGate,
)
from agenticx.rules.disambiguation import resolve_nl_draft
from agenticx.retrieval.disambiguation import ObjectHit, resolve_object_hits


@pytest.mark.asyncio
async def test_dual_path_same_protocol(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)

    def rules_resolver(req):
        if req.field == "object":
            return DisambiguationResponse(request_id=req.id, selected_ids=["device"])
        if req.mode is DisambiguationMode.INFO_SUPPLEMENT:
            return DisambiguationResponse(request_id=req.id, free_text="80")
        if req.candidates:
            return DisambiguationResponse(
                request_id=req.id, selected_ids=[req.candidates[0].id]
            )
        return DisambiguationResponse(request_id=req.id, free_text="ops-channel")

    rules_gate = SyncDisambiguationGate(resolver=rules_resolver)
    draft, rules_sess = await resolve_nl_draft(
        "Create a rule: when temperature is greater than 80 then notify ops-channel",
        lexicon={"objects": ["device", "asset"]},
        gate=rules_gate,
        store=store,
    )
    assert draft.rule is not None
    assert rules_sess is not None
    assert rules_sess.source == "rules.nl"
    assert any(
        row["request"]["mode"] == DisambiguationMode.CANDIDATE_SELECT.value
        for row in rules_sess.resolved
    )

    hits = [
        ObjectHit(id="obj-a", label="Device A", score=0.86),
        ObjectHit(id="obj-b", label="Device B", score=0.85),
    ]

    def ret_resolver(req):
        assert req.mode is DisambiguationMode.CANDIDATE_SELECT
        return DisambiguationResponse(request_id=req.id, selected_ids=["obj-a"])

    ret_gate = SyncDisambiguationGate(resolver=ret_resolver)
    chosen, ret_sess = await resolve_object_hits(hits, gate=ret_gate, store=store)
    assert chosen is not None and chosen.id == "obj-a"
    assert ret_sess is not None
    assert ret_sess.source == "retrieval.object"

    # Same store holds both session sources; same request schema keys.
    sessions = store.list_sessions()
    sources = {s.source for s in sessions}
    assert "rules.nl" in sources and "retrieval.object" in sources
    for s in sessions:
        for row in s.resolved:
            req = row["request"]
            assert "mode" in req and "candidates" in req and "id" in req
            assert req["mode"] in {m.value for m in DisambiguationMode}
