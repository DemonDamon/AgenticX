#!/usr/bin/env python3
"""Tests for ActionProposal + outcome_unknown (OpenMuse-03).

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.reliability.call_ledger import CallLedger
from agenticx.runtime.action_proposals import (
    ActionProposalService,
    HashMismatchError,
    OutcomeUnknownError,
    ProposalExpiredError,
    SilentRetryDeniedError,
    compute_proposal_hash,
    recover_interrupted_proposals,
)


def _payload(**extra: object) -> dict:
    base = {
        "kind": "email.send",
        "title": "Send visit note",
        "data": {"to": ["sam@example.com"], "subject": "Visit"},
    }
    base.update(extra)
    return base


def test_propose_hash_stable(tmp_path: Path) -> None:
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")
    p1 = {"b": 2, "a": 1, "nested": {"z": 0, "y": 1}}
    p2 = {"nested": {"y": 1, "z": 0}, "a": 1, "b": 2}
    assert compute_proposal_hash(p1) == compute_proposal_hash(p2)
    first = service.propose(p1)
    second = service.propose(p2)
    assert first.hash == second.hash
    assert first.hash == compute_proposal_hash(p1)
    assert first.status == "awaiting_review"
    assert second.status == "awaiting_review"


def test_decide_hash_mismatch(tmp_path: Path) -> None:
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")
    proposal = service.propose(_payload())
    with pytest.raises(HashMismatchError, match="changed"):
        service.decide(proposal.id, "stale-hash", "approve")
    still = service.get(proposal.id)
    assert still is not None
    assert still.status == "awaiting_review"


def test_decide_expired(tmp_path: Path) -> None:
    clock = {"t": 1_000_000.0}

    def now() -> float:
        return clock["t"]

    service = ActionProposalService(
        db_path=tmp_path / "proposals.sqlite",
        now=now,
    )
    proposal = service.propose(_payload(), ttl_seconds=60)
    clock["t"] += 61
    with pytest.raises(ProposalExpiredError, match="expired"):
        service.decide(proposal.id, proposal.hash, "approve")
    saved = service.get(proposal.id)
    assert saved is not None
    assert saved.status == "expired"


def test_outcome_unknown(tmp_path: Path) -> None:
    calls = {"n": 0}
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")

    def execute(_proposal: object) -> str:
        calls["n"] += 1
        raise OutcomeUnknownError("Provider response lost")

    proposal = service.propose(_payload())
    result = service.decide(proposal.id, proposal.hash, "approve", execute=execute)
    assert result.status == "outcome_unknown"
    assert "lost" in (result.error or "")
    assert calls["n"] == 1


def test_recover_interrupted(tmp_path: Path) -> None:
    db = tmp_path / "proposals.sqlite"
    first = ActionProposalService(db_path=db)
    proposal = first.propose(_payload())

    # Simulate crash mid-execution: claim to executing without finishing.
    claimed = first.store.claim(
        proposal.id,
        expected_status="awaiting_review",
        expected_hash=proposal.hash,
        new_status="executing",
    )
    assert claimed is not None
    assert claimed.status == "executing"

    n = recover_interrupted_proposals(db_path=db)
    assert n == 1
    second = ActionProposalService(db_path=db)
    saved = second.get(proposal.id)
    assert saved is not None
    assert saved.status == "outcome_unknown"
    assert "restarted" in (saved.error or "").lower()


def test_no_silent_retry(tmp_path: Path) -> None:
    calls = {"n": 0}
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")

    def execute(_proposal: object) -> str:
        calls["n"] += 1
        raise OutcomeUnknownError("uncertain")

    proposal = service.propose(_payload())
    result = service.decide(proposal.id, proposal.hash, "approve", execute=execute)
    assert result.status == "outcome_unknown"
    assert calls["n"] == 1

    # Second decide must not re-run execute.
    again = service.decide(proposal.id, proposal.hash, "approve", execute=execute)
    assert again.status == "outcome_unknown"
    assert calls["n"] == 1

    with pytest.raises(SilentRetryDeniedError, match="Silent retry denied"):
        service.assert_no_silent_retry(proposal.id)


def test_deny_never_executes(tmp_path: Path) -> None:
    calls = {"n": 0}
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")

    def execute(_proposal: object) -> str:
        calls["n"] += 1
        return "sent"

    proposal = service.propose(_payload())
    result = service.decide(proposal.id, proposal.hash, "deny", execute=execute)
    assert result.status == "denied"
    assert calls["n"] == 0


def test_approve_records_call_ledger(tmp_path: Path) -> None:
    db = tmp_path / "proposals.sqlite"
    ledger_root = tmp_path / "sessions"
    service = ActionProposalService(db_path=db, ledger_root=ledger_root)
    proposal = service.propose(_payload(), session_id="sess-ap-1")
    result = service.decide(
        proposal.id,
        proposal.hash,
        "approve",
        execute=lambda _p: "provider-receipt",
    )
    assert result.status == "succeeded"
    assert result.result == "provider-receipt"

    ledger = CallLedger.load("sess-ap-1", root=ledger_root)
    try:
        record = ledger.lookup(proposal.id)
        assert record is not None
        assert record.state == "completed"
        assert record.tool_name == "action_proposal.execute"
    finally:
        ledger.close()


def test_assert_no_silent_retry_allows_succeeded(tmp_path: Path) -> None:
    service = ActionProposalService(db_path=tmp_path / "proposals.sqlite")
    proposal = service.propose(_payload())
    done = service.decide(proposal.id, proposal.hash, "approve")
    assert done.status == "succeeded"
    assert service.assert_no_silent_retry(proposal.id).status == "succeeded"
