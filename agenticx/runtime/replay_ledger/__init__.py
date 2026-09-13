#!/usr/bin/env python3
"""Durable semantic replay ledger.

Author: Damon Li
"""

from agenticx.runtime.replay_ledger.contracts import (
    COMPLETENESS_VALUES,
    ContextCheckpoint,
    EFFECT_CLASSES,
    EVENT_TYPES,
    RUN_STATUSES,
    ReplayRunRecord,
    RunEvent,
    WorkspaceSnapshotRef,
)


def __getattr__(name: str):
    if name == "ReplayLedgerStore":
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        return ReplayLedgerStore
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "COMPLETENESS_VALUES",
    "ContextCheckpoint",
    "EFFECT_CLASSES",
    "EVENT_TYPES",
    "RUN_STATUSES",
    "ReplayLedgerStore",
    "ReplayRunRecord",
    "RunEvent",
    "WorkspaceSnapshotRef",
]
