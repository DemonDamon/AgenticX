#!/usr/bin/env python3
"""Session harness mode helpers (code_dev / daily_office / feature_loop).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

CODE_DEV = "code_dev"
DAILY_OFFICE = "daily_office"
FEATURE_LOOP = "feature_loop"
VALID_MODES = frozenset({CODE_DEV, DAILY_OFFICE, FEATURE_LOOP})

PHASE_EXPLORE = "explore"
PHASE_READ = "read"
PHASE_AUTHOR = "author"
VALID_PHASES = frozenset({PHASE_EXPLORE, PHASE_READ, PHASE_AUTHOR})

READ_FILES_SCRATCH_PREFIX = "read_files::"
DELIVERED_SECTIONS_PREFIX = "delivered_sections::"
PHASE_SCRATCH_KEY = "phase"
EXPLORE_WHOLE_FILE_READ_WARN_KEY = "__code_dev_explore_whole_reads__"


def normalize_session_mode(raw: str | None) -> str:
    """Coerce incoming mode strings into one of the valid mode constants.

    Unknown values fall back to ``DAILY_OFFICE`` to preserve existing behavior.
    """
    value = (raw or "").strip().lower()
    if value == CODE_DEV:
        return CODE_DEV
    if value == FEATURE_LOOP:
        return FEATURE_LOOP
    return DAILY_OFFICE


def is_code_dev(session: Any) -> bool:
    """Return True when the session uses the code_dev harness."""
    return normalize_session_mode(getattr(session, "session_mode", None)) == CODE_DEV


def is_feature_loop(session: Any) -> bool:
    """Return True when the session uses the project-level feature_loop harness."""
    return normalize_session_mode(getattr(session, "session_mode", None)) == FEATURE_LOOP


def get_session_phase(session: Any) -> str:
    """Read the current code_dev phase from the session scratchpad."""
    scratch = getattr(session, "scratchpad", None) or {}
    if not isinstance(scratch, dict):
        return PHASE_EXPLORE
    raw = str(scratch.get(PHASE_SCRATCH_KEY, "") or "").strip().lower()
    return raw if raw in VALID_PHASES else PHASE_EXPLORE
