#!/usr/bin/env python3
"""ActionProposal service: propose / decide / recover / refuse silent retry.

Reuses :class:`agenticx.reliability.call_ledger.CallLedger` for optional
dispatch recording. Does not invent a second fingerprint algorithm.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping

from agenticx.reliability.call_ledger import CallLedger
from agenticx.runtime.action_proposals.errors import (
    HashMismatchError,
    OutcomeUnknownError,
    ProposalExpiredError,
    ProposalNotFoundError,
    SilentRetryDeniedError,
)
from agenticx.runtime.action_proposals.store import (
    ActionProposalRecord,
    ActionProposalStore,
    ProposalStatus,
    default_db_path,
)

logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 30 * 60
RECOVERY_ERROR = (
    "Server restarted during execution. Check the provider before creating another action."
)

ExecuteFn = Callable[[ActionProposalRecord], str]


def compute_proposal_hash(payload: Mapping[str, Any]) -> str:
    """Stable SHA-256 over canonical JSON of the proposal payload."""
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ActionProposalService:
    """Durable review object for external write side effects."""

    def __init__(
        self,
        store: ActionProposalStore | None = None,
        *,
        db_path: Path | str | None = None,
        now: Callable[[], float] | None = None,
        ledger_root: Path | str | None = None,
    ) -> None:
        if store is not None:
            self._store = store
        else:
            self._store = ActionProposalStore(db_path)
        self._now = now or time.time
        self._ledger_root = Path(ledger_root) if ledger_root is not None else None
        self._lock = threading.RLock()

    @property
    def store(self) -> ActionProposalStore:
        return self._store

    def propose(
        self,
        payload: Mapping[str, Any],
        *,
        ttl_seconds: float | None = None,
        session_id: str = "",
        proposal_id: str | None = None,
    ) -> ActionProposalRecord:
        """Create an ``awaiting_review`` proposal with a stable payload hash."""
        if not isinstance(payload, Mapping):
            raise TypeError("payload must be a mapping")
        body = dict(payload)
        ttl = float(DEFAULT_TTL_SECONDS if ttl_seconds is None else ttl_seconds)
        if ttl <= 0:
            ttl = float(DEFAULT_TTL_SECONDS)
        created = float(self._now())
        record = ActionProposalRecord(
            id=str(proposal_id or uuid.uuid4()),
            hash=compute_proposal_hash(body),
            expires_at=created + ttl,
            payload=body,
            status="awaiting_review",
            error=None,
            result=None,
            session_id=str(session_id or ""),
            created_at=created,
            updated_at=created,
        )
        return self._store.put(record)

    def get(self, proposal_id: str) -> ActionProposalRecord | None:
        return self._store.get(proposal_id)

    def decide(
        self,
        proposal_id: str,
        hash: str,
        decision: str,
        *,
        execute: ExecuteFn | None = None,
    ) -> ActionProposalRecord:
        """Approve or deny a proposal.

        On approve: claim ``awaiting_review`` → ``executing``, then run
        ``execute`` (or mark ``succeeded`` with an approval receipt).
        ``OutcomeUnknownError`` from ``execute`` becomes ``outcome_unknown``.
        A second approve on a non-``awaiting_review`` row returns the existing
        record without re-running ``execute`` (no silent retry).
        """
        decision_norm = str(decision or "").strip().lower()
        if decision_norm not in {"approve", "deny"}:
            raise ValueError(f"decision must be approve|deny, got {decision!r}")

        with self._lock:
            proposal = self._store.get(proposal_id)
            if proposal is None:
                raise ProposalNotFoundError(f"Action proposal not found: {proposal_id}")
            if proposal.hash != str(hash or ""):
                raise HashMismatchError(
                    "This proposal changed. Open its latest review before deciding."
                )
            if proposal.status != "awaiting_review":
                # Already decided / recovered — never silently re-execute.
                return proposal

            now = float(self._now())
            if float(proposal.expires_at) <= now:
                expired = self._store.claim(
                    proposal_id,
                    expected_status="awaiting_review",
                    expected_hash=proposal.hash,
                    new_status="expired",
                    now=now,
                    error="This review expired. Create a fresh proposal.",
                )
                if expired is None:
                    current = self._store.get(proposal_id)
                    if current is None:
                        raise ProposalNotFoundError(
                            f"Action proposal not found: {proposal_id}"
                        )
                    return current
                raise ProposalExpiredError(
                    "This review expired. Create a fresh proposal."
                )

            if decision_norm == "deny":
                denied = self._store.claim(
                    proposal_id,
                    expected_status="awaiting_review",
                    expected_hash=proposal.hash,
                    new_status="denied",
                    now=now,
                )
                if denied is None:
                    current = self._store.get(proposal_id)
                    if current is None:
                        raise ProposalNotFoundError(
                            f"Action proposal not found: {proposal_id}"
                        )
                    return current
                return denied

            claimed = self._store.claim(
                proposal_id,
                expected_status="awaiting_review",
                expected_hash=proposal.hash,
                new_status="executing",
                now=now,
            )
            if claimed is None:
                current = self._store.get(proposal_id)
                if current is None:
                    raise ProposalNotFoundError(
                        f"Action proposal not found: {proposal_id}"
                    )
                return current

            self._ledger_dispatch(claimed)

            if execute is None:
                finished = ActionProposalRecord(
                    id=claimed.id,
                    hash=claimed.hash,
                    expires_at=claimed.expires_at,
                    payload=claimed.payload,
                    status="succeeded",
                    error=None,
                    result="approved_for_tool_continuation",
                    session_id=claimed.session_id,
                    created_at=claimed.created_at,
                    updated_at=float(self._now()),
                )
                self._store.put(finished)
                self._ledger_result(finished, success=True, text=finished.result or "")
                return finished

            try:
                result_text = execute(claimed)
                finished = ActionProposalRecord(
                    id=claimed.id,
                    hash=claimed.hash,
                    expires_at=claimed.expires_at,
                    payload=claimed.payload,
                    status="succeeded",
                    error=None,
                    result=str(result_text),
                    session_id=claimed.session_id,
                    created_at=claimed.created_at,
                    updated_at=float(self._now()),
                )
                self._store.put(finished)
                self._ledger_result(finished, success=True, text=str(result_text))
                return finished
            except OutcomeUnknownError as exc:
                finished = ActionProposalRecord(
                    id=claimed.id,
                    hash=claimed.hash,
                    expires_at=claimed.expires_at,
                    payload=claimed.payload,
                    status="outcome_unknown",
                    error=str(exc) or "External write outcome is unknown",
                    result=None,
                    session_id=claimed.session_id,
                    created_at=claimed.created_at,
                    updated_at=float(self._now()),
                )
                self._store.put(finished)
                self._ledger_result(finished, success=False, text=finished.error or "")
                return finished
            except Exception as exc:
                finished = ActionProposalRecord(
                    id=claimed.id,
                    hash=claimed.hash,
                    expires_at=claimed.expires_at,
                    payload=claimed.payload,
                    status="failed",
                    error=str(exc) or "Execution failed",
                    result=None,
                    session_id=claimed.session_id,
                    created_at=claimed.created_at,
                    updated_at=float(self._now()),
                )
                self._store.put(finished)
                self._ledger_result(finished, success=False, text=finished.error or "")
                return finished

    def mark_expired(self, proposal_id: str) -> ActionProposalRecord | None:
        """Best-effort expire an awaiting proposal (e.g. UI TTL timeout)."""
        proposal = self._store.get(proposal_id)
        if proposal is None:
            return None
        if proposal.status != "awaiting_review":
            return proposal
        return self._store.claim(
            proposal_id,
            expected_status="awaiting_review",
            expected_hash=proposal.hash,
            new_status="expired",
            now=float(self._now()),
            error="This review expired. Create a fresh proposal.",
        )

    def recover_interrupted(self) -> list[ActionProposalRecord]:
        """Startup recovery: leftover ``executing`` → ``outcome_unknown``."""
        return self._store.recover_executing(
            error=RECOVERY_ERROR,
            now=float(self._now()),
        )

    def assert_no_silent_retry(self, proposal_id: str) -> ActionProposalRecord:
        """Refuse silent re-execution unless the proposal already succeeded.

        Used by tool layers that might otherwise replay the same write.
        """
        proposal = self._store.get(proposal_id)
        if proposal is None:
            raise ProposalNotFoundError(f"Action proposal not found: {proposal_id}")
        if proposal.status == "succeeded":
            return proposal
        raise SilentRetryDeniedError(
            f"Silent retry denied for proposal {proposal_id} "
            f"(status={proposal.status}). Create a fresh proposal after "
            "checking the provider."
        )

    def _ledger_dispatch(self, proposal: ActionProposalRecord) -> None:
        if not proposal.session_id:
            return
        try:
            ledger = CallLedger(proposal.session_id, root=self._ledger_root)
            try:
                ledger.record_dispatch(
                    proposal.id,
                    "action_proposal.execute",
                    proposal.payload,
                    replay_safety="never",
                )
            finally:
                ledger.close()
        except Exception as exc:
            logger.debug(
                "action_proposal ledger dispatch skipped id=%s: %s",
                proposal.id,
                exc,
            )

    def _ledger_result(
        self,
        proposal: ActionProposalRecord,
        *,
        success: bool,
        text: str,
    ) -> None:
        if not proposal.session_id:
            return
        try:
            ledger = CallLedger(proposal.session_id, root=self._ledger_root)
            try:
                ledger.record_result(proposal.id, text, success=success)
            finally:
                ledger.close()
        except Exception as exc:
            logger.debug(
                "action_proposal ledger result skipped id=%s: %s",
                proposal.id,
                exc,
            )


_default_service: ActionProposalService | None = None
_default_lock = threading.Lock()


def get_default_service() -> ActionProposalService:
    """Process-wide default service (lazy, uses ``action_proposals.sqlite``)."""
    global _default_service
    with _default_lock:
        if _default_service is None:
            _default_service = ActionProposalService(db_path=default_db_path())
        return _default_service


def set_default_service(service: ActionProposalService | None) -> None:
    """Test hook to replace or clear the process-wide default service."""
    global _default_service
    with _default_lock:
        _default_service = service


def recover_interrupted_proposals(
    *,
    db_path: Path | str | None = None,
) -> int:
    """Studio lifespan entry: recover leftover executing proposals.

    Returns the number of rows flipped to ``outcome_unknown``.
    """
    service = ActionProposalService(db_path=db_path)
    recovered = service.recover_interrupted()
    return len(recovered)


# Re-export status type for callers.
__all__ = [
    "ActionProposalService",
    "ProposalStatus",
    "compute_proposal_hash",
    "get_default_service",
    "set_default_service",
    "recover_interrupted_proposals",
]
