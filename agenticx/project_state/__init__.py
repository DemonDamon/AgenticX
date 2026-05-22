#!/usr/bin/env python3
"""Project-level state machine for long-running coding agents.

External, on-disk single source of truth that survives session resets,
machine swaps, and SQLite wipes. Layered on top of agenticx/longrun and
the code_dev harness mode.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.project_state.schema import (
    FEATURE_STATUSES,
    PHASE_COMMIT,
    PHASE_IMPLEMENT,
    PHASE_INITIALIZE,
    PHASE_VERIFY,
    VALID_PHASES,
    Feature,
    FeatureListV1,
    StatusV1,
)
from agenticx.project_state.store import (
    ProjectStateError,
    ProjectStore,
    locate_project_root,
)

__all__ = [
    "FEATURE_STATUSES",
    "PHASE_COMMIT",
    "PHASE_IMPLEMENT",
    "PHASE_INITIALIZE",
    "PHASE_VERIFY",
    "VALID_PHASES",
    "Feature",
    "FeatureListV1",
    "StatusV1",
    "ProjectStateError",
    "ProjectStore",
    "locate_project_root",
]
