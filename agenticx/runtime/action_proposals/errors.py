#!/usr/bin/env python3
"""Errors for durable ActionProposal review.

Author: Damon Li
"""

from __future__ import annotations


class OutcomeUnknownError(Exception):
    """Raised when an external write finishes without a reliable outcome.

    Callers must persist ``outcome_unknown`` and must not silently retry the
    same proposal.
    """

    code = "outcome_unknown"

    def __init__(self, message: str = "External write outcome is unknown") -> None:
        super().__init__(message)
        self.outcome_unknown = True


class ProposalError(Exception):
    """Base class for ActionProposal decision failures."""


class ProposalNotFoundError(ProposalError):
    """Proposal id is missing from the store."""


class HashMismatchError(ProposalError):
    """Caller-supplied hash does not match the persisted proposal."""


class ProposalExpiredError(ProposalError):
    """Proposal TTL elapsed before a decision."""


class SilentRetryDeniedError(ProposalError):
    """Refuses silent re-execution of a non-succeeded proposal."""
