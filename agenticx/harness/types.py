#!/usr/bin/env python3
"""Core types for the unified harness control surface.

SP1 of the harness-control-surface plan: one protocol every coding-agent
harness adapter implements (Claude Code / CodeBuddy today, Codex / OpenCode
in SP2, the builtin python-agent runtime in SP3).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


class HarnessError(Exception):
    """Base class for harness control surface errors."""


class UnknownHarnessError(HarnessError):
    """Requested harness id is not registered."""

    def __init__(self, harness_id: str, available: list[str]) -> None:
        self.harness_id = harness_id
        self.available = list(available)
        suffix = ", ".join(self.available) if self.available else "(none)"
        super().__init__(f"unknown harness: {harness_id}; available: {suffix}")


class CapabilityNotSupported(HarnessError):
    """Adapter does not implement an optional capability-gated operation."""

    def __init__(self, harness_id: str, capability: str, hint: str = "") -> None:
        self.harness_id = harness_id
        self.capability = capability
        self.hint = hint
        msg = f"harness {harness_id} does not support {capability}"
        if hint:
            msg = f"{msg}: {hint}"
        super().__init__(msg)


class SessionNotFoundError(HarnessError):
    """Harness session id is unknown to the adapter."""


class TurnInProgressError(HarnessError):
    """A turn is already in flight for this session (resend protection)."""

    def __init__(self, session_id: str, detail: str = "") -> None:
        self.session_id = session_id
        self.detail = detail
        msg = f"a turn is already in flight for session {session_id}"
        if detail:
            msg = f"{msg}; {detail}"
        super().__init__(msg)


@dataclass(frozen=True)
class HarnessCapabilities:
    """Declared feature surface of one adapter.

    UI and callers must degrade by these flags instead of hardcoding
    harness identities (master-plan discipline #5).
    """

    # POST .../permission respond flow (auto or operator approval channel).
    permission: bool = False
    # PTY interactive sessions (write / resize / raw byte stream).
    pty: bool = False
    # Raw streaming of harness output while a turn runs.
    streaming: bool = False
    # Structured per-turn metadata (observed_tools / usage / turn_seq).
    turn_snapshots: bool = False
    # idempotency_key dedup on turns.
    idempotency: bool = False
    # Resume a native harness thread by id (SP4 handoff "resume" strategy).
    resume: bool = False
    # Inject a ContextHandoff payload at spawn/turn time (SP4).
    handoff_injection: bool = False

    def as_dict(self) -> Dict[str, bool]:
        return {
            "permission": self.permission,
            "pty": self.pty,
            "streaming": self.streaming,
            "turn_snapshots": self.turn_snapshots,
            "idempotency": self.idempotency,
            "resume": self.resume,
            "handoff_injection": self.handoff_injection,
        }


@dataclass
class TurnRequest:
    """One user turn dispatched to a harness session."""

    text: str
    wait_seconds: float = 180.0
    # Honored only when capabilities.idempotency is True.
    idempotency_key: str = ""


# Unified turn status set. Each adapter maps its native outcome onto these:
#   success         turn finished with a successful result
#   running         turn still in flight (observable via describe)
#   blocked         turn ended on a permission denial (harness has no
#                   approval channel or the operator denied)
#   error           turn ended with an error
#   exited          child process exited before/while finishing the turn
#   timeout         caller stopped waiting; final state unknown
#   unknown_session session id is not known to the adapter
TURN_STATUS_SUCCESS = "success"
TURN_STATUS_RUNNING = "running"
TURN_STATUS_BLOCKED = "blocked"
TURN_STATUS_ERROR = "error"
TURN_STATUS_EXITED = "exited"
TURN_STATUS_TIMEOUT = "timeout"
TURN_STATUS_UNKNOWN_SESSION = "unknown_session"

TURN_STATUSES = frozenset(
    {
        TURN_STATUS_SUCCESS,
        TURN_STATUS_RUNNING,
        TURN_STATUS_BLOCKED,
        TURN_STATUS_ERROR,
        TURN_STATUS_EXITED,
        TURN_STATUS_TIMEOUT,
        TURN_STATUS_UNKNOWN_SESSION,
    }
)


@dataclass
class TurnResult:
    """Normalized outcome of one turn."""

    harness: str
    session_id: str
    status: str
    result_text: str = ""
    tail: str = ""
    deduplicated: bool = False
    # Harness-specific extras (parse_confidence, turn_seq, observed_tools...).
    detail: Dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == TURN_STATUS_SUCCESS


@dataclass
class PermissionDecision:
    """Operator/auto decision for a pending harness permission request."""

    request_id: str
    allow: bool
    deny_message: str = "Denied by operator"
    tool_input: Optional[Dict[str, Any]] = None
    tool_use_id: Optional[str] = None


@dataclass(frozen=True)
class HarnessDescriptor:
    """What /v1/harnesses reports for one registered adapter."""

    harness_id: str
    display_name: str
    description: str = ""
    capabilities: HarnessCapabilities = HarnessCapabilities()
    # Whether the underlying CLI is installed on this machine (UI graying).
    available: bool = False
