"""R2-3: NL ambiguities map onto shared disambiguation protocol."""

from __future__ import annotations

import pytest

from agenticx.runtime.disambiguation import (
    DisambiguationFileStore,
    DisambiguationMode,
    DisambiguationResponse,
    SyncDisambiguationGate,
)
from agenticx.rules.disambiguation import (
    ambiguities_to_requests,
    resolve_nl_draft,
    resolve_nl_draft_sync,
)
from agenticx.rules.nl import NlAmbiguity, draft_rule_from_nl


CREATE_MISSING_OBJECT = (
    "Create a rule: when temperature is greater than 80 then notify ops-channel"
)
CREATE_MISSING_THRESHOLD = (
    "Create a rule: when device temperature is high then notify ops-channel"
)


def test_candidates_become_candidate_select() -> None:
    amb = NlAmbiguity(
        field="object",
        candidates=["device", "asset"],
        reason="pick object",
    )
    reqs = ambiguities_to_requests([amb])
    assert len(reqs) == 1
    assert reqs[0].mode is DisambiguationMode.CANDIDATE_SELECT
    assert [c.id for c in reqs[0].candidates] == ["device", "asset"]


def test_empty_candidates_become_info_supplement() -> None:
    amb = NlAmbiguity(field="body", candidates=[], reason="parse error")
    reqs = ambiguities_to_requests([amb])
    assert reqs[0].mode is DisambiguationMode.INFO_SUPPLEMENT
    assert reqs[0].allow_free_text is True


def test_sync_open_session_for_ambiguous_nl(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    draft, session = resolve_nl_draft_sync(
        CREATE_MISSING_OBJECT,
        lexicon={"objects": ["device", "asset", "sensor"]},
        store=store,
    )
    assert draft.rule is None
    assert session is not None
    assert session.source == "rules.nl"
    assert any(r.field == "object" for r in session.pending)
    assert any(r.mode is DisambiguationMode.CANDIDATE_SELECT for r in session.pending)


@pytest.mark.asyncio
async def test_gate_resolves_to_rule_draft(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)

    def resolver(req):
        # Prefer device for object; 80 for threshold if asked.
        if req.field == "object":
            return DisambiguationResponse(request_id=req.id, selected_ids=["device"])
        if req.field == "threshold":
            pick = "80" if any(c.id == "80" for c in req.candidates) else req.candidates[0].id
            if req.mode is DisambiguationMode.INFO_SUPPLEMENT:
                return DisambiguationResponse(request_id=req.id, free_text="80")
            return DisambiguationResponse(request_id=req.id, selected_ids=[pick])
        if req.candidates:
            return DisambiguationResponse(
                request_id=req.id, selected_ids=[req.candidates[0].id]
            )
        return DisambiguationResponse(request_id=req.id, free_text="ops-channel")

    gate = SyncDisambiguationGate(resolver=resolver)
    draft, session = await resolve_nl_draft(
        CREATE_MISSING_OBJECT,
        lexicon={"objects": ["device", "asset", "sensor"]},
        gate=gate,
        store=store,
    )
    assert session is not None
    assert draft.rule is not None
    assert draft.ambiguities == []
    assert draft.rule.body["object"] == "device"


@pytest.mark.asyncio
async def test_threshold_qualitative_via_slots(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)

    def resolver(req):
        if req.mode is DisambiguationMode.INFO_SUPPLEMENT:
            return DisambiguationResponse(request_id=req.id, free_text="90")
        if req.field == "threshold":
            return DisambiguationResponse(request_id=req.id, selected_ids=["90"])
        return DisambiguationResponse(
            request_id=req.id, selected_ids=[req.candidates[0].id]
        )

    gate = SyncDisambiguationGate(resolver=resolver)
    draft, session = await resolve_nl_draft(
        CREATE_MISSING_THRESHOLD,
        gate=gate,
        store=store,
    )
    assert draft.rule is not None
    assert draft.rule.body["condition"]["value"] == 90
    assert session is not None
