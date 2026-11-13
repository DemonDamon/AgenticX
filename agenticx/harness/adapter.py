#!/usr/bin/env python3
"""HarnessAdapter protocol: the six core operations of the control surface.

``spawn / turn / stream / permission / stop / capabilities`` (master plan
section 5). ``describe`` / ``list_sessions`` / ``available`` round out the
surface the unified HTTP API and the desktop UI need.

Adapters normalize their native session/turn semantics onto the types in
``agenticx.harness.types``. The existing cc/wb bridge HTTP apps remain the
authoritative surface for their own legacy APIs; this protocol is the new,
unified path (master plan discipline #2: additive, no behavior change).

Author: Damon Li
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Iterator, List, Optional

from agenticx.harness.types import (
    CapabilityNotSupported,
    HarnessCapabilities,
    PermissionDecision,
    SessionNotFoundError,
    TurnRequest,
    TurnResult,
)


class HarnessAdapter(ABC):
    """One coding-agent harness behind the unified control surface.

    Implementations own their native sessions (subprocess, thread, or
    remote) and translate to/from the normalized shapes. Optional
    operations are capability-gated: the base implementations raise
    :class:`CapabilityNotSupported` so callers can degrade by
    :meth:`capabilities` instead of probing with try/except.
    """

    #: Stable registry id, e.g. "claude-code", "codebuddy", "python-agent".
    harness_id: str = ""
    #: Human name for pickers, e.g. "Claude Code".
    display_name: str = ""
    #: One-line description for /v1/harnesses and UI tooltips.
    description: str = ""

    # ------------------------------------------------------------------
    # capabilities
    # ------------------------------------------------------------------
    @abstractmethod
    def capabilities(self) -> HarnessCapabilities:
        """Declare the feature surface of this adapter."""

    # ------------------------------------------------------------------
    # spawn
    # ------------------------------------------------------------------
    @abstractmethod
    def spawn(
        self,
        cwd: str,
        *,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Start a new harness session; return the normalized session view.

        ``options`` carries harness-specific spawn knobs:
        claude-code: {"mode": "headless"|"visible_tui",
                      "auto_allow_permissions": bool}
        codebuddy:   {"permission_mode": "default"|"acceptEdits"|...}
        Implementations must validate known keys and raise ``ValueError``
        on invalid values (mapped to HTTP 400 by the control surface).
        """

    # ------------------------------------------------------------------
    # turn
    # ------------------------------------------------------------------
    @abstractmethod
    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        """Dispatch one user turn and wait up to ``request.wait_seconds``.

        Adapters with an in-flight turn model must protect against
        duplicate dispatch (raise :class:`TurnInProgressError`) and honor
        ``request.idempotency_key`` when capabilities declare it.
        """

    # ------------------------------------------------------------------
    # stop
    # ------------------------------------------------------------------
    @abstractmethod
    def stop(self, session_id: str) -> bool:
        """Terminate and forget a session; False when unknown."""

    # ------------------------------------------------------------------
    # stream (capability-gated)
    # ------------------------------------------------------------------
    def iter_stream_chunks(self, session_id: str) -> Iterator[bytes]:
        """Yield raw harness output bytes until session end/disconnect."""
        raise CapabilityNotSupported(self.harness_id, "streaming")

    # ------------------------------------------------------------------
    # permission (capability-gated)
    # ------------------------------------------------------------------
    def permission(self, session_id: str, decision: PermissionDecision) -> None:
        """Answer a pending permission request from the harness."""
        raise CapabilityNotSupported(self.harness_id, "permission")

    # ------------------------------------------------------------------
    # PTY passthrough (capability-gated)
    # ------------------------------------------------------------------
    def write_pty(self, session_id: str, data: str) -> None:
        """Write raw keystrokes to an interactive PTY session."""
        raise CapabilityNotSupported(self.harness_id, "pty")

    def resize_pty(self, session_id: str, rows: int, cols: int) -> None:
        """Propagate terminal size to an interactive PTY session."""
        raise CapabilityNotSupported(self.harness_id, "pty")

    # ------------------------------------------------------------------
    # introspection
    # ------------------------------------------------------------------
    @abstractmethod
    def available(self) -> bool:
        """True when the underlying CLI/runtime is usable on this machine."""

    @abstractmethod
    def describe(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Normalized single-session view, or None when unknown."""

    @abstractmethod
    def list_sessions(self) -> List[Dict[str, Any]]:
        """Normalized views for every live session of this adapter."""

    # ------------------------------------------------------------------
    # native thread adoption (SP4 handoff extension, resume tier)
    # ------------------------------------------------------------------
    def adopt_thread(self, session_id: str, native_thread_id: str) -> None:
        """Adopt a pre-existing native harness thread for a live session.

        Only resume-capable adapters implement this: the handoff resume
        tier re-attaches the native thread the target harness previously
        owned instead of starting a fresh one.
        """
        raise NotImplementedError(
            f"harness {self.harness_id} cannot adopt native threads"
        )

    # ------------------------------------------------------------------
    # helpers for implementations
    # ------------------------------------------------------------------
    def _require_session(self, session_id: str) -> None:
        if self.describe(session_id) is None:
            raise SessionNotFoundError(session_id)
