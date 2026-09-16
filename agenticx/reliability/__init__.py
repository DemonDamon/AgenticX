#!/usr/bin/env python3
"""Reliability kernel for tool-call identity, durability, and replay safety.

This package must stay free of ``agenticx.studio`` / ``agenticx.cli`` imports.

Author: Damon Li
"""

from agenticx.reliability.call_identity import (
    canonical_call_key,
    canonical_payload,
    diff_canonical_fields,
    stable_call_id,
)
from agenticx.reliability.call_ledger import (
    CallLedger,
    CallRecord,
    CallState,
    Reconciliation,
    Verdict,
)
from agenticx.reliability.errors import (
    LedgerCorruptError,
    ReliabilityError,
    ToolCallIdentityError,
)
from agenticx.reliability.replay_policy import (
    ReplayDecision,
    ReplayRequest,
    decide_replay,
)
from agenticx.reliability.run_state import (
    RUN_STATE_SCHEMA_VERSION,
    PendingCall,
    RunState,
    RunStateStore,
)


def reliability_posture() -> str:
    """Re-export of the runtime posture resolver (see harden_flags)."""
    from agenticx.runtime.harden_flags import reliability_posture as _impl

    return _impl()


__all__ = [
    "CallLedger",
    "CallRecord",
    "CallState",
    "LedgerCorruptError",
    "PendingCall",
    "RUN_STATE_SCHEMA_VERSION",
    "Reconciliation",
    "ReliabilityError",
    "ReplayDecision",
    "ReplayRequest",
    "RunState",
    "RunStateStore",
    "ToolCallIdentityError",
    "Verdict",
    "canonical_call_key",
    "canonical_payload",
    "decide_replay",
    "diff_canonical_fields",
    "reliability_posture",
    "stable_call_id",
]
