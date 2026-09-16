#!/usr/bin/env python3
"""Reliability kernel exceptions.

Author: Damon Li
"""

from __future__ import annotations


class ReliabilityError(Exception):
    """Base class for reliability-kernel failures."""


class ToolCallIdentityError(ReliabilityError):
    """Same ``call_id`` reappeared with a different canonical payload.

    This is never recoverable by retrying: the model either fabricated an id
    or the transport corrupted the call. Fail loudly instead of guessing which
    payload was intended.
    """

    def __init__(
        self,
        call_id: str,
        *,
        recorded_key: str,
        incoming_key: str,
        changed_fields: tuple[str, ...] = (),
    ) -> None:
        self.call_id = call_id
        self.recorded_key = recorded_key
        self.incoming_key = incoming_key
        self.changed_fields = changed_fields
        fields = ", ".join(changed_fields) if changed_fields else "<unknown>"
        super().__init__(
            f"tool call id {call_id!r} reused with different arguments: "
            f"recorded key {recorded_key[:16]}, incoming key {incoming_key[:16]}, "
            f"changed fields: {fields}"
        )


class LedgerCorruptError(ReliabilityError):
    """Ledger file exists but cannot be parsed into a usable state."""
