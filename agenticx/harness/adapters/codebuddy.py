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
from agenticx.harness.codebuddy_auth import (
    codebuddy_login_required_from_lines,
    is_codebuddy_auth_failure_text,
)
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
from agenticx.wb_bridge.codebuddy_agent_await import (
    await_agent_artifacts,
    codebuddy_cc_subagent_guard_prefix,
    honesty_footer,
    parse_agent_spawns_from_lines,
    user_asked_for_claude_code_subagents,
)
from agenticx.harness.codebuddy_cc_subagents import (
    maybe_run_cc_subagents_for_codebuddy_turn,
)

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
            return self._turn_result(
                session_id,
                status,
                snap,
                deduplicated=True,
                user_text=request.text,
            )

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

        # Cross-harness: user asked for Claude Code as subagents → Near spawns
        # real `claude` CLI sessions instead of letting CodeBuddy Agent pretend.
        session = self.get(session_id)
        cwd = str(getattr(session, "cwd", "") or "") if session else ""
        model = None
        if session is not None:
            model = getattr(session, "model", None) or None
        owner_sid = (
            str(getattr(request, "owner_session_id", "") or "").strip()
            or str(getattr(request, "studio_session_id", "") or "").strip()
            or str(session_id or "").strip()
        )
        intercepted = maybe_run_cc_subagents_for_codebuddy_turn(
            parent_session_id=owner_sid,
            user_text=request.text,
            cwd=cwd,
            wait_seconds=request.wait_seconds,
            model=(str(model).strip() or None) if model else None,
        )
        if intercepted is not None:
            return intercepted

        outbound = request.text
        guard = codebuddy_cc_subagent_guard_prefix(request.text)
        if guard:
            outbound = guard + (request.text or "")
        try:
            self.send_user_message(session_id, outbound, idempotency_key=key)
        except KeyError as exc:
            raise SessionNotFoundError(session_id) from exc
        status, snap = self.wait_for_turn(session_id, request.wait_seconds)
        return self._turn_result(
            session_id,
            status,
            snap,
            deduplicated=False,
            user_text=request.text,
        )

    def _turn_result(
        self,
        session_id: str,
        status: str,
        snap: Dict[str, Any],
        *,
        deduplicated: bool,
        user_text: str = "",
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
        turn_lines = self._turn_stream_lines(session_id)
        if unified == TURN_STATUS_SUCCESS:
            # d37c29ea: Agent "Spawned successfully" then parent turn ended while
            # teammates never wrote report_*.md — and user asked for Claude Code.
            spawns = parse_agent_spawns_from_lines(turn_lines)
            asked_cc = user_asked_for_claude_code_subagents(user_text)
            await_info = None
            if spawns:
                session = self.get(session_id)
                cwd = str(getattr(session, "cwd", "") or "") if session else ""
                detail["codebuddy_agent_spawns"] = [
                    {
                        "name": s.name,
                        "agent_id": s.agent_id,
                        "team_name": s.team_name,
                        "task_id": s.task_id,
                        "expected_paths": list(s.expected_paths),
                    }
                    for s in spawns
                ]
                await_info = await_agent_artifacts(
                    spawns, cwd=cwd, timeout_sec=45.0
                )
                detail["codebuddy_agent_await"] = await_info
                if asked_cc:
                    detail["codebuddy_claimed_claude_code"] = True
            footer = honesty_footer(
                asked_for_claude_code=asked_cc,
                spawns=spawns,
                await_info=await_info,
            )
            if footer:
                result_text = (result_text or "") + footer
                if len(result_text) > _RESULT_TEXT_MAX_CHARS:
                    result_text = result_text[:_RESULT_TEXT_MAX_CHARS]
        if unified != TURN_STATUS_SUCCESS:
            visible = self._turn_error_visible_text(session_id)
            if visible:
                detail["error_visible_text"] = visible[:_RESULT_TEXT_MAX_CHARS]
            if codebuddy_login_required_from_lines(
                turn_lines, turn_failed=True
            ) or is_codebuddy_auth_failure_text(visible):
                detail["codebuddy_login_required"] = True
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=unified,
            result_text=result_text,
            tail=str(snap.get("tail", "") or ""),
            deduplicated=deduplicated,
            detail=detail,
        )

    def _turn_stream_lines(self, session_id: str) -> list[str]:
        """Stdout lines belonging to the current turn (excludes earlier turns)."""
        session = self.get(session_id)
        if session is None:
            return []
        with session.lock:
            start = max(0, int(session.turn_line_start or 0))
            return list(session.lines[start:])

    def _turn_error_visible_text(self, session_id: str) -> str:
        """Assistant text emitted before a non-success result, if any."""
        return visible_assistant_text_from_lines(self._turn_stream_lines(session_id))

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
