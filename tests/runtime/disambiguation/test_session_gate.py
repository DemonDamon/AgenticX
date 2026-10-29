"""R2-2: disambiguation session store + gate multi-turn."""

from __future__ import annotations

import pytest

from agenticx.runtime.disambiguation import (
    DisambiguationCandidate,
    DisambiguationError,
    DisambiguationFileStore,
    DisambiguationMode,
    DisambiguationRequest,
    DisambiguationResponse,
    DisambiguationSessionStatus,
    RecordingDisambiguationGate,
    SyncDisambiguationGate,
    apply_response_to_session,
    new_request_id,
)


def _cand_req(field: str = "object", *labels: str) -> DisambiguationRequest:
    labels = labels or ("device", "asset")
    return DisambiguationRequest(
        id=new_request_id(),
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt=f"pick {field}",
        field=field,
        candidates=[DisambiguationCandidate(id=l, label=l) for l in labels],
    )


def test_store_create_persist_reload(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    req = _cand_req()
    sess = store.create_session(source="rules.nl", pending=[req])
    assert sess.status is DisambiguationSessionStatus.OPEN
    assert sess.pending[0].session_id == sess.id

    store2 = DisambiguationFileStore(tmp_path)
    loaded = store2.get_session(sess.id)
    assert loaded.source == "rules.nl"
    assert len(loaded.pending) == 1
    assert loaded.pending[0].candidates[0].id == "device"


def test_apply_response_fills_slots_and_completes(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    r1 = _cand_req("object", "device", "asset")
    r2 = DisambiguationRequest(
        id=new_request_id(),
        mode=DisambiguationMode.INFO_SUPPLEMENT,
        prompt="threshold?",
        field="threshold",
        allow_free_text=True,
    )
    sess = store.create_session(source="rules.nl", pending=[r1, r2])

    sess = apply_response_to_session(
        sess, DisambiguationResponse(request_id=r1.id, selected_ids=["device"])
    )
    assert sess.slots["object"] == "device"
    assert sess.status is DisambiguationSessionStatus.OPEN
    assert len(sess.pending) == 1

    sess = apply_response_to_session(
        sess, DisambiguationResponse(request_id=r2.id, free_text="80")
    )
    assert sess.slots["threshold"] == "80"
    assert sess.status is DisambiguationSessionStatus.COMPLETED
    assert sess.pending == []
    store.upsert_session(sess)
    assert store.get_session(sess.id).status is DisambiguationSessionStatus.COMPLETED


def test_cancel_clears_pending(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    r1 = _cand_req()
    sess = store.create_session(source="retrieval.object", pending=[r1])
    sess = apply_response_to_session(
        sess, DisambiguationResponse(request_id=r1.id, cancelled=True)
    )
    assert sess.status is DisambiguationSessionStatus.CANCELLED
    assert sess.pending == []


def test_missing_session_keyerror(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    with pytest.raises(KeyError):
        store.get_session("missing")


def test_list_sessions_filter(tmp_path) -> None:
    store = DisambiguationFileStore(tmp_path)
    store.create_session(source="rules.nl", pending=[_cand_req()])
    store.create_session(source="retrieval.object", pending=[_cand_req("id", "a", "b")])
    assert len(store.list_sessions(source="rules.nl")) == 1
    assert len(store.list_sessions(status=DisambiguationSessionStatus.OPEN)) == 2


@pytest.mark.asyncio
async def test_sync_gate_resolver() -> None:
    def resolver(req: DisambiguationRequest) -> DisambiguationResponse:
        return DisambiguationResponse(
            request_id=req.id, selected_ids=[req.candidates[0].id]
        )

    gate = SyncDisambiguationGate(resolver=resolver)
    req = _cand_req()
    resp = await gate.request(req)
    assert resp.selected_ids == ["device"]
    assert gate.last_request is req


@pytest.mark.asyncio
async def test_recording_gate_needs_push() -> None:
    gate = RecordingDisambiguationGate()
    req = _cand_req()
    with pytest.raises(DisambiguationError, match="no response"):
        await gate.request(req)
    gate.push_response(
        DisambiguationResponse(request_id=req.id, selected_ids=["asset"])
    )
    resp = await gate.request(req)
    assert resp.selected_ids == ["asset"]
