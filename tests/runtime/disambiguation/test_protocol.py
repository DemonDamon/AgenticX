"""R2-1: disambiguation protocol model validation + serde."""

from __future__ import annotations

import pytest

from agenticx.runtime.disambiguation import (
    DisambiguationCandidate,
    DisambiguationConflict,
    DisambiguationError,
    DisambiguationMode,
    DisambiguationRequest,
    DisambiguationResponse,
    request_from_dict,
    request_to_dict,
    response_from_dict,
    response_to_dict,
    validate_request,
    validate_response,
)


def test_candidate_select_requires_candidates() -> None:
    req = DisambiguationRequest(
        id="r1",
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt="pick object",
        field="object",
        candidates=[],
    )
    with pytest.raises(DisambiguationError, match="candidate"):
        validate_request(req)


def test_info_supplement_requires_free_text_flag() -> None:
    req = DisambiguationRequest(
        id="r2",
        mode=DisambiguationMode.INFO_SUPPLEMENT,
        prompt="supply threshold",
        field="threshold",
        allow_free_text=False,
    )
    with pytest.raises(DisambiguationError, match="allow_free_text"):
        validate_request(req)


def test_conflict_resolve_requires_payload() -> None:
    req = DisambiguationRequest(
        id="r3",
        mode=DisambiguationMode.CONFLICT_RESOLVE,
        prompt="resolve attr",
        field="status",
    )
    with pytest.raises(DisambiguationError, match="conflict"):
        validate_request(req)


def test_good_candidate_request_and_response_roundtrip() -> None:
    req = DisambiguationRequest(
        id="r4",
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt="Which object?",
        field="object",
        candidates=[
            DisambiguationCandidate(id="device", label="device", score=0.9),
            DisambiguationCandidate(id="asset", label="asset", score=0.8),
        ],
        session_id="s1",
    )
    validate_request(req)
    blob = request_to_dict(req)
    restored = request_from_dict(blob)
    assert restored.mode is DisambiguationMode.CANDIDATE_SELECT
    assert len(restored.candidates) == 2
    assert restored.session_id == "s1"

    resp = DisambiguationResponse(request_id="r4", selected_ids=["device"])
    validate_response(req, resp)
    assert response_from_dict(response_to_dict(resp)).selected_ids == ["device"]


def test_response_rejects_unknown_candidate() -> None:
    req = DisambiguationRequest(
        id="r5",
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt="pick",
        candidates=[DisambiguationCandidate(id="a", label="A")],
    )
    validate_request(req)
    with pytest.raises(DisambiguationError, match="unknown"):
        validate_response(req, DisambiguationResponse(request_id="r5", selected_ids=["z"]))


def test_info_supplement_response_needs_text() -> None:
    req = DisambiguationRequest(
        id="r6",
        mode=DisambiguationMode.INFO_SUPPLEMENT,
        prompt="threshold?",
        field="threshold",
        allow_free_text=True,
    )
    validate_request(req)
    with pytest.raises(DisambiguationError, match="free_text"):
        validate_response(req, DisambiguationResponse(request_id="r6"))
    validate_response(
        req, DisambiguationResponse(request_id="r6", free_text="80")
    )


def test_conflict_with_candidates_ok() -> None:
    req = DisambiguationRequest(
        id="r7",
        mode=DisambiguationMode.CONFLICT_RESOLVE,
        prompt="status conflict",
        field="status",
        conflicts=[
            DisambiguationConflict(
                field="status",
                values=["online", "offline"],
                sources=["ledger", "sensor"],
                reason="multi-source disagree",
            )
        ],
        candidates=[
            DisambiguationCandidate(id="ledger::online", label="online (ledger)"),
            DisambiguationCandidate(id="sensor::offline", label="offline (sensor)"),
        ],
    )
    validate_request(req)
    validate_response(
        req,
        DisambiguationResponse(request_id="r7", selected_ids=["ledger::online"]),
    )


def test_cancelled_skips_payload_checks() -> None:
    req = DisambiguationRequest(
        id="r8",
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt="pick",
        candidates=[DisambiguationCandidate(id="a", label="A")],
    )
    validate_response(
        req, DisambiguationResponse(request_id="r8", cancelled=True)
    )
