#!/usr/bin/env python3
"""Claude Code adapter for the unified harness control surface.

Wraps the existing ``cc_bridge.BridgeSessionManager`` (subclass): the
legacy ``agx cc-bridge serve`` HTTP app keeps its own manager instance and
behavior; this adapter is the same engine behind the unified protocol.

Author: Damon Li
"""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict, Iterator, Optional

import ujson

from agenticx.cc_bridge.session_manager import BridgeSession, BridgeSessionManager
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.cc_result_sanitize import sanitize_claude_code_result_text
from agenticx.harness.types import (
    CapabilityNotSupported,
    HarnessCapabilities,
    PermissionDecision,
    TURN_STATUS_EXITED,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_TIMEOUT,
    SessionNotFoundError,
    TurnRequest,
    TurnResult,
)

_RESULT_TEXT_MAX_CHARS = 4000

_CC_MODES = frozenset({"headless", "visible_tui"})


def _last_result_text(session: BridgeSession) -> str:
    """Best-effort ``result`` field from the last NDJSON result line.

    Sanitize before truncating so a long thinking preamble cannot push the
    real answer past ``_RESULT_TEXT_MAX_CHARS``.
    """
    with session.lock:
        lines = list(session.lines)
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = ujson.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(obj, dict) or obj.get("type") != "result":
            continue
        result = obj.get("result")
        if result is None:
            return ""
        cleaned = sanitize_claude_code_result_text(str(result))
        return cleaned[:_RESULT_TEXT_MAX_CHARS]
    return ""


class ClaudeCodeAdapter(BridgeSessionManager, HarnessAdapter):
    """``claude`` CLI (stream-json headless + interactive PTY) as adapter #1."""

    harness_id = "claude-code"
    display_name = "Claude Code"
    description = "Anthropic Claude Code CLI (BYOS; stream-json + PTY modes)"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=True,  # headless control_request flow
            pty=True,  # visible_tui sessions
            streaming=True,  # raw PTY byte stream
            turn_snapshots=False,
            idempotency=False,
            resume=False,
            handoff_injection=False,
        )

    def available(self) -> bool:
        exe = os.environ.get("CC_BRIDGE_EXECUTABLE", "claude").strip() or "claude"
        return shutil.which(exe) is not None

    # ------------------------------------------------------------------
    # spawn
    # ------------------------------------------------------------------
    def spawn(
        self,
        cwd: str,
        *,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Start a Claude Code CLI session.

        Supported ``options``:
        - ``mode``: ``"headless"`` (default) or ``"visible_tui"``
        - ``auto_allow_permissions``: optional bool (headless control_request)
        - ``model``: optional non-empty string; forwarded as ``claude --model <id>``
          so the Near chat model picker can select the CLI model for this session
        """
        opts = dict(options or {})
        mode = str(opts.pop("mode", "headless")).strip().lower()
        if mode not in _CC_MODES:
            raise ValueError(
                f"mode must be one of {sorted(_CC_MODES)}, got: {mode!r}"
            )
        auto_allow = opts.pop("auto_allow_permissions", None)
        if auto_allow is not None and not isinstance(auto_allow, bool):
            raise ValueError("auto_allow_permissions must be a boolean")
        model = opts.pop("model", None)
        if model is not None and not isinstance(model, str):
            raise ValueError("model must be a string")
        model_id = str(model or "").strip() or None
        if opts:
            raise ValueError(f"unknown spawn options for claude-code: {sorted(opts)}")
        session = self.start_session(
            cwd,
            auto_allow_permissions=auto_allow,
            mode=mode,
            model=model_id,
        )
        view = self.describe(session.session_id)
        assert view is not None  # just registered by start_session
        return view

    # ------------------------------------------------------------------
    # turn
    # ------------------------------------------------------------------
    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        try:
            self.send_user_message(session_id, request.text)
        except KeyError as exc:
            raise SessionNotFoundError(session_id) from exc

        if session.session_kind == "visible_tui":
            ok, parsed, confidence, tail = self.wait_for_visible_tui_result(
                session_id, request.wait_seconds
            )
            status = TURN_STATUS_SUCCESS if ok else TURN_STATUS_TIMEOUT
            cleaned = (
                sanitize_claude_code_result_text(parsed) if ok else ""
            )
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=status,
                result_text=cleaned[:_RESULT_TEXT_MAX_CHARS] if cleaned else "",
                tail=tail,
                detail={
                    "mode": "visible_tui",
                    "parse_confidence": confidence,
                },
            )

        ok, tail = self.wait_for_success_result(session_id, request.wait_seconds)
        if ok:
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_SUCCESS,
                result_text=_last_result_text(session),
                tail=tail,
                detail={"mode": "headless"},
            )
        if session.proc.poll() is not None:
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_EXITED,
                result_text="",
                tail=tail,
                detail={"mode": "headless", "exit_code": session.exit_code},
            )
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_TIMEOUT,
            result_text="",
            tail=tail,
            detail={
                "mode": "headless",
                "wait_seconds": request.wait_seconds,
                "hint": (
                    "still waiting when wait_seconds elapsed; poll describe() "
                    "and do not assume failure"
                ),
            },
        )

    # ------------------------------------------------------------------
    # stop
    # ------------------------------------------------------------------
    def stop(self, session_id: str) -> bool:
        return self.stop_session(session_id)

    # ------------------------------------------------------------------
    # stream / PTY passthrough
    # ------------------------------------------------------------------
    def iter_stream_chunks(self, session_id: str) -> Iterator[bytes]:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.session_kind != "visible_tui":
            raise CapabilityNotSupported(
                self.harness_id,
                "streaming",
                hint="streaming is only available for visible_tui sessions",
            )
        return self.iter_pty_stream_chunks(session_id)

    def write_pty(self, session_id: str, data: str) -> None:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.session_kind != "visible_tui":
            raise CapabilityNotSupported(
                self.harness_id,
                "pty",
                hint="write is only available for visible_tui sessions",
            )
        try:
            self.write_pty_raw(session_id, data)
        except KeyError as exc:
            raise SessionNotFoundError(session_id) from exc

    def resize_pty(self, session_id: str, rows: int, cols: int) -> None:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.session_kind != "visible_tui":
            raise CapabilityNotSupported(
                self.harness_id,
                "pty",
                hint="resize is only available for visible_tui sessions",
            )
        try:
            self.resize_pty_session(session_id, rows, cols)
        except KeyError as exc:
            raise SessionNotFoundError(session_id) from exc

    # ------------------------------------------------------------------
    # permission
    # ------------------------------------------------------------------
    def permission(self, session_id: str, decision: PermissionDecision) -> None:
        session = self.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        if session.session_kind == "visible_tui":
            raise CapabilityNotSupported(
                self.harness_id,
                "permission",
                hint=(
                    "visible_tui sessions approve interactively in the "
                    "terminal; the HTTP permission API is headless-only"
                ),
            )
        try:
            self.respond_permission(
                session_id,
                decision.request_id,
                decision.allow,
                tool_input=decision.tool_input,
                tool_use_id=decision.tool_use_id,
                deny_message=decision.deny_message,
            )
        except KeyError as exc:
            message = str(exc) or "session closed"
            if "visible_tui" in message:
                raise CapabilityNotSupported(
                    self.harness_id,
                    "permission",
                    hint=message,
                ) from exc
            raise SessionNotFoundError(session_id) from exc

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
            "mode": raw.get("mode", "headless"),
        }
        view["raw"] = raw
        return view

    def list_sessions(self) -> list[Dict[str, Any]]:
        return [
            self.describe(str(row.get("session_id") or ""))  # type: ignore[arg-type]
            for row in super().list_sessions()
        ]


__all__ = ["ClaudeCodeAdapter"]
