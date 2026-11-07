#!/usr/bin/env python3
"""CodeBuddy (WB) adapter for the unified harness control surface.

Wraps the existing ``wb_bridge.WbBridgeSessionManager`` (subclass): the
legacy ``agx wb-bridge serve`` HTTP app keeps its own manager instance and
behavior; this adapter is the same engine behind the unified protocol.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.stream_json_text import visible_assistant_text_from_lines
from agenticx.harness.types import (
    CapabilityNotSupported,
    HarnessCapabilities,
    PermissionDecision,
    TURN_STATUS_BLOCKED,
    TURN_STATUS_ERROR,
    TURN_STATUS_EXITED,
    TURN_STATUS_RUNNING,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_UNKNOWN_SESSION,
    SessionNotFoundError,
    TurnInProgressError,
    TurnRequest,
    TurnResult,
)
from agenticx.wb_bridge.session_manager import WbBridgeSessionManager
from agenticx.wb_bridge.settings import resolve_codebuddy_executable

_PERMISSION_MODES = frozenset(
    {"default", "acceptEdits", "bypassPermissions", "dontAsk", "plan", "auto"}
)

_PERMISSION_HINT = (
    "CodeBuddy headless has no approval channel (no --permission-prompt-tool "
    "support); Near run_mode=auto maps spawn to permission_mode=acceptEdits. "
    "ask/allowlist keep CB default and may stall on gated tools — use auto "
    "or pass permission_mode=dontAsk/bypassPermissions for unattended work"
)

# wb wait_for_turn statuses -> unified statuses (identity for these five).
_WB_STATUS_MAP = {
    "success": TURN_STATUS_SUCCESS,
    "blocked": TURN_STATUS_BLOCKED,
    "error": TURN_STATUS_ERROR,
    "running": TURN_STATUS_RUNNING,
    "exited": TURN_STATUS_EXITED,
}

_RESULT_TEXT_MAX_CHARS = 4000


def _exit_stderr_excerpt(tail: str, *, limit: int = 500) -> str:
    """Prefer ``[stderr]`` lines from a session tail for exit diagnostics."""
    if not tail:
        return ""
    stderr_lines: list[str] = []
    for raw in tail.splitlines():
        line = raw.rstrip()
        if line.startswith("[stderr] "):
            stderr_lines.append(line[len("[stderr] ") :])
        elif "Cannot find module" in line or "MODULE_NOT_FOUND" in line:
            stderr_lines.append(line)
    if stderr_lines:
        return "\n".join(stderr_lines)[-limit:]
    # Fall back to the end of the raw tail so exit is never empty noise.
    return tail[-limit:].strip()



class CodeBuddyAdapter(WbBridgeSessionManager, HarnessAdapter):
    """``codebuddy`` CLI (headless stream-json, turn snapshots) as adapter #2."""

    harness_id = "codebuddy"
    display_name = "CodeBuddy"
    description = "Tencent CodeBuddy CLI (BYOS; headless stream-json with turn snapshots)"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,
            pty=False,
            streaming=False,
            turn_snapshots=True,
            idempotency=True,
            resume=False,
            handoff_injection=False,
        )

    def available(self) -> bool:
        try:
            resolve_codebuddy_executable()
            return True
        except RuntimeError:
            return False

    # ------------------------------------------------------------------
    # spawn
    # ------------------------------------------------------------------
    def spawn(
        self,
        cwd: str,
        *,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Start a CodeBuddy CLI session.

        Supported ``options``:
        - ``permission_mode``: CodeBuddy ``--permission-mode`` value
        - ``model``: optional non-empty string → ``codebuddy --model <id>``
        """
        opts = dict(options or {})
        permission_mode = str(opts.pop("permission_mode", "default")).strip()
        if permission_mode not in _PERMISSION_MODES:
            raise ValueError(
                "permission_mode must be one of "
                f"{sorted(_PERMISSION_MODES)}, got: {permission_mode!r}"
            )
        model = opts.pop("model", None)
        if model is not None and not isinstance(model, str):
            raise ValueError("model must be a string")
        model_id = str(model or "").strip() or None
        if opts:
            raise ValueError(f"unknown spawn options for codebuddy: {sorted(opts)}")
        session = self.start_session(
            cwd, permission_mode=permission_mode, model=model_id
        )
        view = self.describe(session.session_id)
        assert view is not None  # just registered by start_session
        return view

    # ------------------------------------------------------------------
    # turn
    # ------------------------------------------------------------------
    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        key = (request.idempotency_key or "").strip()
        if key and self.turn_matches_idempotency_key(session_id, key):
            status, snap = self.wait_for_turn(session_id, request.wait_seconds)
            return self._turn_result(session_id, status, snap, deduplicated=True)

        snapshot = self.describe_session(session_id)
        if snapshot is None:
            raise SessionNotFoundError(session_id)
        if snapshot.get("turn_state") == "running":
            raise TurnInProgressError(
                session_id,
                detail=(
                    f"turn_seq={snapshot.get('turn_seq')}, "
                    f"elapsed={snapshot.get('turn_elapsed_sec')}s, "
                    f"last_activity={snapshot.get('last_activity') or 'n/a'}"
                ),
            )

        try:
            self.send_user_message(session_id, request.text, idempotency_key=key)
        except KeyError as exc:
            raise SessionNotFoundError(session_id) from exc
        status, snap = self.wait_for_turn(session_id, request.wait_seconds)
        return self._turn_result(session_id, status, snap, deduplicated=False)

    def _turn_result(
        self,
        session_id: str,
        status: str,
        snap: Dict[str, Any],
        *,
        deduplicated: bool,
    ) -> TurnResult:
        if status == TURN_STATUS_UNKNOWN_SESSION:
            raise SessionNotFoundError(session_id)
        unified = _WB_STATUS_MAP.get(status, TURN_STATUS_ERROR)
        result_text = ""
        if unified == TURN_STATUS_SUCCESS:
            result_text = str(snap.get("last_result_text", "") or "")
        elif unified == TURN_STATUS_EXITED:
            # Surface stderr (e.g. MODULE_NOT_FOUND from a broken app bundle)
            # so Near's "[harness codebuddy turn exited]" banner is actionable.
            result_text = _exit_stderr_excerpt(str(snap.get("tail", "") or ""))
        detail = {
            k: snap.get(k)
            for k in (
                "turn_seq",
                "turns_completed",
                "observed_tools",
                "written_paths",
                "usage_totals",
                "terminal_detail",
                "stalled",
                "last_activity",
                "first_activity_lag_sec",
                "permission_mode",
            )
            if k in snap
        }
        if unified != TURN_STATUS_SUCCESS:
            visible = self._turn_error_visible_text(session_id)
            if visible:
                detail["error_visible_text"] = visible[:_RESULT_TEXT_MAX_CHARS]
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=unified,
            result_text=result_text,
            tail=str(snap.get("tail", "") or ""),
            deduplicated=deduplicated,
            detail=detail,
        )

    def _turn_error_visible_text(self, session_id: str) -> str:
        """Assistant text emitted before a non-success result, if any."""
        session = self.get(session_id)
        if session is None:
            return ""
        with session.lock:
            start = max(0, int(session.turn_line_start or 0))
            lines = list(session.lines[start:])
        return visible_assistant_text_from_lines(lines)

    # ------------------------------------------------------------------
    # stop
    # ------------------------------------------------------------------
    def stop(self, session_id: str) -> bool:
        return self.stop_session(session_id)

    # ------------------------------------------------------------------
    # permission (capability-gated off)
    # ------------------------------------------------------------------
    def permission(self, session_id: str, decision: PermissionDecision) -> None:
        if self.get(session_id) is None:
            raise SessionNotFoundError(session_id)
        raise CapabilityNotSupported(
            self.harness_id,
            "permission",
            hint=_PERMISSION_HINT,
        )

    # ------------------------------------------------------------------
    # introspection
    # ------------------------------------------------------------------
    def describe(self, session_id: str) -> Optional[Dict[str, Any]]:
        raw = self.describe_session(session_id)
        if raw is None:
            return None
        view: Dict[str, Any] = {
            "harness": self.harness_id,
            "session_id": raw.get("session_id", session_id),
            "cwd": raw.get("cwd", ""),
            "pid": raw.get("pid"),
            "state": raw.get("state", "running"),
            "permission_mode": raw.get("permission_mode", "default"),
            "model": raw.get("model"),
            "turn_state": raw.get("turn_state", "idle"),
        }
        view["raw"] = raw
        return view

    def list_sessions(self) -> list[Dict[str, Any]]:
        return [
            self.describe(str(row.get("session_id") or ""))  # type: ignore[arg-type]
            for row in super().list_sessions()
        ]


__all__ = ["CodeBuddyAdapter"]
