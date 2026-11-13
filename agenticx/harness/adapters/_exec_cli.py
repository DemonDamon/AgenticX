#!/usr/bin/env python3
"""Shared engine for process-per-turn CLI harness adapters (SP2).

OpenCode (``opencode run --format json``) and Codex (``codex exec --json``)
share one execution model: every turn spawns a fresh CLI child that streams
NDJSON events, exits when the turn ends, and can be resumed later by passing
the native thread/session id back to the CLI. This module owns that engine
(spawn bookkeeping, in-flight protection, timeout, stop); subclasses only
declare the command shape and translate native events.

Author: Damon Li
"""

from __future__ import annotations

import os
import queue
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional
from collections import deque

import ujson

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.types import (
    TURN_STATUS_ERROR,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_TIMEOUT,
    SessionNotFoundError,
    TurnInProgressError,
    TurnRequest,
    TurnResult,
)

_READ_LINE_JOIN_SECONDS = 2.0
_TAIL_MAX_CHARS = 2000


def _plain_cli_tail(tail: str) -> str:
    """Human-readable CLI lines, skipping NDJSON event envelopes."""
    lines: List[str] = []
    for raw in (tail or "").splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("{") and stripped.endswith("}"):
            continue
        if stripped.startswith("Reading additional input from stdin"):
            continue
        lines.append(stripped)
    return "\n".join(lines).strip()



@dataclass
class ExecCliSession:
    """Bookkeeping for one logical harness session."""

    session_id: str
    cwd: str
    options: Dict[str, Any] = field(default_factory=dict)
    # Native harness thread/session id (opencode ses_*, codex thread id).
    native_thread_id: Optional[str] = None
    state: str = "idle"  # idle | running
    turn_count: int = 0
    last_result_text: str = ""
    last_tail: str = ""
    # Populated while a turn runs (exec --json) or for a long-lived
    # Codex app-server process that stays up across turns.
    proc: Optional[subprocess.Popen] = None
    # Mid-turn stream items drained by Near's 200ms SSE pump.
    midturn_items: Deque[Dict[str, Any]] = field(default_factory=deque)
    midturn_lock: threading.Lock = field(default_factory=threading.Lock)
    # Codex app-server bookkeeping (unused by OpenCode).
    app_server_ready: bool = False
    app_server_thread_loaded: bool = False
    app_server_provider: Optional[str] = None
    app_server_rpc: Any = None


class ExecCliHarnessAdapter(HarnessAdapter):
    """Base class for ``run/exec``-style CLI harnesses.

    Subclasses implement :meth:`_default_executable`, :meth:`_env_var`,
    :meth:`_validate_options`, :meth:`_build_args` and
    :meth:`_consume_event`.
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, ExecCliSession] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # subclass contract
    # ------------------------------------------------------------------
    def _default_executable(self) -> str:
        """CLI binary name when the env override is unset."""

    def _env_var(self) -> str:
        """Env var that overrides the executable path (tests / BYOS)."""

    def _validate_options(self, options: Dict[str, Any]) -> None:
        """Raise ValueError on unknown/invalid spawn options."""

    def _build_args(self, session: ExecCliSession, text: str) -> List[str]:
        """Full argv (excluding the executable) for one turn."""

    def _consume_event(
        self, event: Dict[str, Any], session: ExecCliSession, acc: Dict[str, Any]
    ) -> None:
        """Fold one parsed NDJSON event into ``acc`` / session state.

        ``acc`` keys consumed by the engine: ``result_text`` (str),
        ``native_thread_id`` (str), ``error`` (str), plus free-form detail.
        """

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def executable(self) -> str:
        override = os.environ.get(self._env_var(), "").strip()
        return override or self._default_executable()

    def available(self) -> bool:
        return shutil.which(self.executable()) is not None

    def _get(self, session_id: str) -> ExecCliSession:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        return session

    # ------------------------------------------------------------------
    # spawn / stop
    # ------------------------------------------------------------------
    def spawn(
        self,
        cwd: str,
        *,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        opts = dict(options or {})
        self._validate_options(opts)
        if not cwd or not os.path.isdir(cwd):
            raise ValueError(f"cwd must be an existing directory, got: {cwd!r}")
        session_id = str(uuid.uuid4())
        session = ExecCliSession(
            session_id=session_id, cwd=cwd, options=opts
        )
        with self._lock:
            self._sessions[session_id] = session
        view = self.describe(session_id)
        assert view is not None
        return view

    def stop(self, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        proc = session.proc
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        return True

    # ------------------------------------------------------------------
    # turn
    # ------------------------------------------------------------------
    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        session = self._get(session_id)

        # In-flight protection: one child process per session at a time.
        with self._lock:
            if session.state == "running":
                raise TurnInProgressError(session_id)
            session.state = "running"

        argv = [self.executable()] + self._build_args(session, request.text)
        acc: Dict[str, Any] = {"result_text": "", "detail": {}}
        try:
            proc = subprocess.Popen(
                argv,
                cwd=session.cwd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            with self._lock:
                session.state = "idle"
            raise
        session.proc = proc

        lines = queue.Queue()  # type: queue.Queue[Optional[str]]
        reader_error: List[str] = []

        def _read_stdout() -> None:
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    lines.put(line)
            except Exception as exc:  # pragma: no cover - defensive
                reader_error.append(str(exc))
            finally:
                lines.put(None)

        reader = threading.Thread(target=_read_stdout, daemon=True)
        reader.start()

        tail_lines: List[str] = []
        timed_out = False
        deadline = request.wait_seconds if request.wait_seconds > 0 else None
        started = time.monotonic()
        while True:
            remaining = None
            if deadline is not None:
                remaining = deadline - (time.monotonic() - started)
                if remaining <= 0:
                    timed_out = True
                    break
            try:
                line = lines.get(timeout=min(remaining or 0.2, 0.2))
            except queue.Empty:
                continue
            if line is None:
                break
            stripped = line.strip()
            if not stripped:
                continue
            tail_lines.append(stripped[-_TAIL_MAX_CHARS:])
            if len(tail_lines) > 200:
                tail_lines = tail_lines[-200:]
            try:
                event = ujson.loads(stripped)
            except (ValueError, TypeError):
                continue
            if isinstance(event, dict):
                try:
                    self._consume_event(event, session, acc)
                except Exception:  # pragma: no cover - parser robustness
                    continue

        if timed_out:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:  # pragma: no cover
                    pass
        reader.join(timeout=_READ_LINE_JOIN_SECONDS)
        exit_code = proc.poll()
        if exit_code is None:  # pragma: no cover - killed but not reaped
            proc.wait()
            exit_code = proc.poll()

        session.proc = None
        session.turn_count += 1
        native_id = acc.get("native_thread_id")
        if native_id and not session.native_thread_id:
            session.native_thread_id = str(native_id)
        result_text = str(acc.get("result_text") or "")
        error_text = str(acc.get("error") or "")
        session.last_result_text = result_text
        session.last_tail = "\n".join(tail_lines[-20:])
        detail: Dict[str, Any] = dict(acc.get("detail") or {})
        detail["native_thread_id"] = session.native_thread_id
        detail["turn_count"] = session.turn_count
        detail["exit_code"] = exit_code

        with self._lock:
            session.state = "idle"

        tail = "\n".join(tail_lines[-20:])
        visible_tail = _plain_cli_tail(tail)
        if timed_out:
            timeout_detail = dict(detail, wait_seconds=request.wait_seconds)
            if visible_tail and not timeout_detail.get("terminal_detail"):
                timeout_detail["terminal_detail"] = visible_tail[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_TIMEOUT,
                result_text="",
                tail=tail,
                detail=timeout_detail,
            )
        if error_text:
            err_detail = dict(detail, error=error_text[:500])
            if not err_detail.get("terminal_detail") and not err_detail.get(
                "error_visible_text"
            ):
                err_detail["terminal_detail"] = error_text[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                tail=tail,
                detail=err_detail,
            )
        if exit_code not in (0, None):
            fail_detail = dict(detail)
            if visible_tail and not fail_detail.get("terminal_detail") and not fail_detail.get(
                "error_visible_text"
            ):
                fail_detail["terminal_detail"] = visible_tail[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                tail=tail,
                detail=fail_detail,
            )
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_SUCCESS,
            result_text=result_text,
            tail=tail,
            detail=detail,
        )

    # ------------------------------------------------------------------
    # native thread adoption (SP4 resume tier)
    # ------------------------------------------------------------------
    def refresh_session_options(
        self, session_id: str, options: Optional[Dict[str, Any]]
    ) -> None:
        """Replace spawn options on a live session without respawning.

        Used when Near run_mode changes mid-session. Codex applies the
        new sandbox via turn/start ``sandboxPolicy``; exec --json still
        cannot change ``--sandbox`` on resume (#332).
        """
        opts = dict(options or {})
        self._validate_options(opts)
        session = self._get(session_id)
        session.options = opts

    def adopt_thread(self, session_id: str, native_thread_id: str) -> None:
        if not (native_thread_id or "").strip():
            raise ValueError("native_thread_id must be non-empty")
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise SessionNotFoundError(session_id)
            if session.state == "running":
                raise TurnInProgressError(session_id)
            session.native_thread_id = native_thread_id.strip()

    # ------------------------------------------------------------------
    # introspection
    # ------------------------------------------------------------------
    def describe(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None:
            return None
        view: Dict[str, Any] = {
            "harness": self.harness_id,
            "session_id": session.session_id,
            "cwd": session.cwd,
            "state": session.state,
            "turn_count": session.turn_count,
            "native_thread_id": session.native_thread_id,
            "last_result_text": session.last_result_text,
        }
        if session.options:
            view["options"] = dict(session.options)
        return view

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._lock:
            ids = list(self._sessions.keys())
        out: List[Dict[str, Any]] = []
        for sid in ids:
            view = self.describe(sid)
            if view is not None:
                out.append(view)
        return out
