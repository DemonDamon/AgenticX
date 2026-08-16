#!/usr/bin/env python3
"""Session evidence model — grade *how much we can trust* session outcome claims.

Deterministic, read-only classification of what actually happened in a session,
from two on-disk sources:

- ``tool_call_observations.json`` (written by ``ObservationHook``)
- ``messages.json`` (session history)

The central idea (adapted from an external rubric, not upstream code) is that
evidence strength *caps* any quality score derived from it: a session that
produced writes but never ran a verifier can look busy while remaining
unverified, and must not be scored as "validated".

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any


class EvidenceState(str, Enum):
    """How strongly the available evidence supports a conclusion."""

    MISSING = "missing"  # rank 0 — nothing was done and we can see it
    UNOBSERVED = "unobserved"  # rank 0 — may have happened; we can't see it
    PRESENT = "present"  # rank 1 — the thing exists / happened
    WIRED = "wired"  # rank 2 — it is connected into the loop
    EXERCISED = "exercised"  # rank 3 — it actually ran
    OUTCOME_SUPPORTED = "outcome_supported"  # rank 4 — ran with a positive result
    NOT_APPLICABLE = "not_applicable"  # rank -1 — dimension doesn't apply


EVIDENCE_RANK: dict[EvidenceState, int] = {
    EvidenceState.MISSING: 0,
    EvidenceState.UNOBSERVED: 0,
    EvidenceState.PRESENT: 1,
    EvidenceState.WIRED: 2,
    EvidenceState.EXERCISED: 3,
    EvidenceState.OUTCOME_SUPPORTED: 4,
    EvidenceState.NOT_APPLICABLE: -1,
}

# Evidence level → maximum score (0-100). Core rubric of this module:
# a score may not exceed the cap implied by the evidence behind it.
EVIDENCE_SCORE_CAP: dict[EvidenceState, int] = {
    EvidenceState.MISSING: 20,
    EvidenceState.UNOBSERVED: 40,
    EvidenceState.PRESENT: 55,
    EvidenceState.WIRED: 70,
    EvidenceState.EXERCISED: 85,
    EvidenceState.OUTCOME_SUPPORTED: 100,
    EvidenceState.NOT_APPLICABLE: 100,
}

# Tools that can act as verifiers. ``bash_exec`` needs a second-level check on
# the command text; observations don't persist arguments (only result_summary),
# so we match the command signature against the result preview as well.
VERIFICATION_TOOLS = frozenset({"bash_exec", "run_tests", "liteparse"})
VERIFICATION_CMD_RE = re.compile(
    r"\b(pytest|npm\s+(run\s+)?(test|typecheck|build)|pnpm\s+(test|typecheck|build)"
    r"|tsc\b|go\s+test|cargo\s+test|ruff|mypy|eslint)\b"
)

# Tools with write side effects.
WRITE_TOOLS = frozenset({"file_write", "file_edit", "str_replace", "apply_patch", "skill_manage"})

# User-correction detector for delivery classification.
CORRECTION_RE = re.compile(
    r"(不对|错了|不是这样|重来|回退|revert|undo|that'?s wrong|not what)", re.IGNORECASE
)


@dataclass
class SessionEvidence:
    """Aggregated facts about one session, derived from observations/messages."""

    verification_calls: int = 0  # times a verification-class tool ran
    verification_success: int = 0  # of those, how many succeeded
    write_calls: int = 0  # times a tool with write side effects ran
    user_turns: int = 0
    user_correction_turns: int = 0  # user messages that read as corrections
    confirm_events: int = 0  # high-risk actions requiring user confirmation
    observations_available: bool = True  # tool_call_observations.json existed
    messages_available: bool = True  # messages.json existed


def _is_verification_call(tool_name: str, result_summary: str) -> bool:
    """Decide whether an observation is a verification action.

    ``run_tests``/``liteparse`` count unconditionally. ``bash_exec`` only counts
    when the command signature appears in either the tool name or the result
    summary (arguments are not persisted by the observer).
    """
    if tool_name == "bash_exec":
        hay = f"{tool_name}\n{result_summary or ''}"
        return bool(VERIFICATION_CMD_RE.search(hay))
    return tool_name in VERIFICATION_TOOLS


def collect_session_evidence(
    observations: list[dict[str, Any]],
    messages: list[dict[str, Any]] | None = None,
) -> SessionEvidence:
    """Aggregate session facts from observation + message records."""
    ev = SessionEvidence()
    ev.observations_available = len(observations) > 0
    ev.messages_available = bool(messages)

    for obs in observations:
        tool = str(obs.get("tool_name", ""))
        success = bool(obs.get("success", True))
        summary = str(obs.get("result_summary", "") or "")

        if tool in WRITE_TOOLS:
            ev.write_calls += 1
        if success and _is_verification_call(tool, summary):
            ev.verification_calls += 1
            ev.verification_success += 1
        if tool in {"confirm_required", "user_confirm"}:
            ev.confirm_events += 1

    if messages:
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role", "")) != "user":
                continue
            ev.user_turns += 1
            content = msg.get("content")
            text = content if isinstance(content, str) else str(content or "")
            if CORRECTION_RE.search(text):
                ev.user_correction_turns += 1

    return ev


def classify_validation_evidence(ev: SessionEvidence) -> EvidenceState:
    """Grade the evidence behind the change-validation dimension."""
    if ev.verification_success > 0:
        return EvidenceState.OUTCOME_SUPPORTED
    if ev.verification_calls > 0:
        return EvidenceState.EXERCISED
    if ev.write_calls > 0 and not ev.observations_available:
        return EvidenceState.UNOBSERVED
    if ev.write_calls > 0:
        return EvidenceState.PRESENT
    if ev.observations_available:
        # Observations exist but nothing was written: nothing to validate.
        return EvidenceState.NOT_APPLICABLE
    return EvidenceState.MISSING


def classify_delivery_evidence(ev: SessionEvidence) -> EvidenceState:
    """Grade the evidence behind the reliable-delivery dimension."""
    if ev.user_turns >= 2 and ev.user_correction_turns == 0 and ev.verification_success > 0:
        return EvidenceState.OUTCOME_SUPPORTED
    if ev.user_turns >= 2 and ev.user_correction_turns == 0:
        return EvidenceState.EXERCISED
    if ev.user_turns >= 2:
        return EvidenceState.WIRED
    if not ev.messages_available:
        return EvidenceState.UNOBSERVED
    return EvidenceState.PRESENT


def cap_score(raw_score: int, state: EvidenceState) -> int:
    """A score may not exceed the cap implied by its evidence level."""
    return min(int(raw_score), EVIDENCE_SCORE_CAP[state])
