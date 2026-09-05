#!/usr/bin/env python3
"""Subprocess sessions for the local CodeBuddy (WB) bridge.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agenticx.cc_bridge.ndjson import build_user_message_line
from agenticx.wb_bridge import events as wb_events
from agenticx.wb_bridge.settings import resolve_codebuddy_executable

_LOG = logging.getLogger(__name__)

_PERMISSION_MODES = frozenset(
    {"default", "acceptEdits", "bypassPermissions", "dontAsk", "plan", "auto"}
)


def _normalize_permission_mode(raw: str) -> str:
    mode = (raw or "").strip()
    if mode in _PERMISSION_MODES:
        return mode
    return "default"


@dataclass
class WbBridgeSession:
    session_id: str
    cwd: str
    proc: subprocess.Popen[str]
    lines: List[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    done: threading.Event = field(default_factory=threading.Event)
    exit_code: Optional[int] = None
    log_path: str = ""
    log_lock: threading.Lock = field(default_factory=threading.Lock)
    permission_mode: str = "default"
    turn_state: str = "idle"  # "idle" | "running"
    turn_seq: int = 0  # incremented on each send
    turns_completed: int = 0
    dispatched_at: Optional[float] = None  # time.monotonic() at send
    first_activity_at: Optional[float] = None  # first tool_use of current turn
    terminal_at: Optional[float] = None  # last terminal result
    last_activity: str = ""  # e.g. "Write" / "Bash"
    last_activity_at: Optional[float] = None
    observed_tools: List[str] = field(default_factory=list)  # current turn, dedup, cap 20
    written_paths: List[str] = field(default_factory=list)  # current turn, dedup, cap 20
    last_terminal_kind: str = ""  # "success" | "blocked" | "error"
    last_terminal_detail: str = ""
    last_result_text: str = ""
    last_duration_ms: Optional[int] = None
    last_num_turns: Optional[int] = None
    usage_totals: Dict[str, int] = field(default_factory=dict)
    blocked_count: int = 0
    turn_done: threading.Event = field(default_factory=threading.Event)
    turn_line_start: int = 0  # lines index at last send; 0 if never sent
    last_idempotency_key: str = ""

    def append_line(self, line: str) -> None:
        with self.lock:
            self.lines.append(line)
            if len(self.lines) > 2000:
                self.lines = self.lines[-2000:]

    def recent_text(self, max_lines: int = 80) -> str:
        with self.lock:
            chunk = self.lines[-max_lines:]
        return "\n".join(chunk)

    def append_log(self, line: str) -> None:
        if not self.log_path:
            return
        with self.log_lock:
            try:
                dest = Path(self.log_path)
                with dest.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except OSError:
                pass

    def observe_line(self, line: str) -> None:
        """Update turn state from one stdout line. Never raises."""
        try:
            with self.lock:
                activity = wb_events.extract_tool_activity(line)
                if activity is not None:
                    now = time.monotonic()
                    self.last_activity = activity
                    self.last_activity_at = now
                    if self.first_activity_at is None:
                        self.first_activity_at = now
                    if activity not in self.observed_tools and len(self.observed_tools) < 20:
                        self.observed_tools.append(activity)
                for path in wb_events.extract_written_paths(line):
                    if path not in self.written_paths and len(self.written_paths) < 20:
                        self.written_paths.append(path)

                if wb_events.line_is_turn_terminal(line):
                    obj = wb_events.parse_stream_line(line)
                    kind, detail = wb_events.classify_result(obj)
                    self.last_terminal_kind = kind
                    self.last_terminal_detail = detail
                    self.last_result_text = wb_events.extract_result_text(obj)
                    if isinstance(obj, dict):
                        try:
                            self.last_duration_ms = int(obj["duration_ms"])
                        except (KeyError, ValueError, TypeError):
                            pass
                        try:
                            self.last_num_turns = int(obj["num_turns"])
                        except (KeyError, ValueError, TypeError):
                            pass
                    for k, v in wb_events.extract_usage(obj).items():
                        self.usage_totals[k] = self.usage_totals.get(k, 0) + v
                    self.turns_completed += 1
                    if kind == "blocked":
                        self.blocked_count += 1
                    self.turn_state = "idle"
                    self.terminal_at = time.monotonic()
                    self.turn_done.set()
        except Exception as exc:  # never kill the reader thread
            _LOG.warning("observe_line failed session=%s err=%s", self.session_id, exc)


def _reader_thread(session: WbBridgeSession, stream: Any) -> None:
    try:
        for raw in iter(stream.readline, ""):
            if raw == "":
                break
            line = raw.rstrip("\n\r")
            session.append_line(line)
            session.append_log(line)
            session.observe_line(line)
    finally:
        try:
            stream.close()
        except OSError:
            pass


def _stderr_thread(session: WbBridgeSession, stream: Any) -> None:
    try:
        for raw in iter(stream.readline, ""):
            if raw == "":
                break
            line = "[stderr] " + raw.rstrip("\n\r")
            session.append_line(line)
            session.append_log(line)
    finally:
        try:
            stream.close()
        except OSError:
            pass


class WbBridgeSessionManager:
    """Owns CodeBuddy child processes and stdout/stdin wiring."""

    def __init__(self) -> None:
        self._sessions: Dict[str, WbBridgeSession] = {}
        self._global_lock = threading.Lock()

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._global_lock:
            return [self._session_to_dict(sid, s) for sid, s in self._sessions.items()]

    def describe_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._global_lock:
            s = self._sessions.get(session_id)
            if s is None:
                return None
            return self._session_to_dict(session_id, s)

    def _session_to_dict(self, sid: str, s: WbBridgeSession) -> Dict[str, Any]:
        poll = s.proc.poll()
        running = poll is None
        now = time.monotonic()
        with s.lock:
            turn_elapsed = (
                round(now - s.dispatched_at, 1)
                if s.dispatched_at and s.turn_state == "running"
                else None
            )
            last_activity_age = (
                round(now - s.last_activity_at, 1) if s.last_activity_at else None
            )
            first_activity_lag = (
                round(s.first_activity_at - s.dispatched_at, 1)
                if s.first_activity_at and s.dispatched_at
                else None
            )
            return {
                "session_id": sid,
                "cwd": s.cwd,
                "pid": s.proc.pid,
                "poll": poll,
                "log_path": s.log_path,
                "state": "running" if running else "stopped",
                "permission_mode": s.permission_mode,
                "turn_state": s.turn_state,
                "turn_seq": s.turn_seq,
                "turn_elapsed_sec": turn_elapsed,
                "turns_completed": s.turns_completed,
                "last_activity": s.last_activity,
                "last_activity_age_sec": last_activity_age,
                "first_activity_lag_sec": first_activity_lag,
                "observed_tools": list(s.observed_tools),
                "written_paths": list(s.written_paths),
                "last_terminal_kind": s.last_terminal_kind,
                "terminal_detail": s.last_terminal_detail,
                "last_result_text": s.last_result_text[:2000],
                "last_duration_ms": s.last_duration_ms,
                "last_num_turns": s.last_num_turns,
                "usage_totals": dict(s.usage_totals),
                "blocked_count": s.blocked_count,
                "exit_code": s.exit_code,
            }

    def get(self, session_id: str) -> Optional[WbBridgeSession]:
        with self._global_lock:
            return self._sessions.get(session_id)

    def _write_stdin(self, session: WbBridgeSession, data: str) -> None:
        if session.proc.stdin is None:
            return
        try:
            session.proc.stdin.write(data)
            session.proc.stdin.flush()
        except BrokenPipeError:
            _LOG.warning("stdin broken for session %s", session.session_id)
        except OSError as exc:
            _LOG.warning("stdin write failed session=%s err=%s", session.session_id, exc)

    def start_session(self, cwd: str, *, permission_mode: str = "default") -> WbBridgeSession:
        return self._start_session_headless(cwd, permission_mode=permission_mode)

    def _log_path_for_sid(self, sid: str) -> str:
        log_dir = Path(os.environ.get("WB_BRIDGE_LOG_DIR", "~/.agenticx/logs/wb-bridge")).expanduser()
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            return str((log_dir / f"{sid}.log").resolve())
        except OSError:
            return ""

    def _start_session_headless(
        self,
        cwd: str,
        *,
        permission_mode: str = "default",
    ) -> WbBridgeSession:
        exe = resolve_codebuddy_executable()
        mode = _normalize_permission_mode(permission_mode)

        path = Path(cwd).resolve()
        path.mkdir(parents=True, exist_ok=True)

        args = [
            exe,
            "--print",
            "--verbose",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--permission-mode",
            mode,
        ]

        env = os.environ.copy()
        env.setdefault("CODEBUDDY_ENVIRONMENT_KIND", "agx_wb_bridge")

        proc = subprocess.Popen(
            args,
            cwd=str(path),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )

        sid = str(uuid.uuid4())
        log_path = self._log_path_for_sid(sid)
        session = WbBridgeSession(
            session_id=sid,
            cwd=str(path),
            proc=proc,
            log_path=log_path,
            permission_mode=mode,
        )
        session.append_log(
            f"[bridge] started headless session_id={sid} pid={proc.pid} cwd={path} argv={args}"
        )

        assert proc.stdout is not None
        assert proc.stderr is not None

        threading.Thread(
            target=_reader_thread,
            args=(session, proc.stdout),
            daemon=True,
        ).start()
        threading.Thread(
            target=_stderr_thread,
            args=(session, proc.stderr),
            daemon=True,
        ).start()

        with self._global_lock:
            self._sessions[sid] = session

        threading.Thread(target=self._wait_proc, args=(session,), daemon=True).start()
        return session

    def _wait_proc(self, session: WbBridgeSession) -> None:
        code = session.proc.wait()
        session.exit_code = code
        session.done.set()

    def turn_matches_idempotency_key(self, session_id: str, key: str) -> bool:
        """True when ``key`` is non-empty and equals this session's last key."""
        if not key:
            return False
        session = self.get(session_id)
        if session is None:
            return False
        with session.lock:
            return bool(session.last_idempotency_key) and session.last_idempotency_key == key

    def send_user_message(self, session_id: str, text: str, *, idempotency_key: str = "") -> None:
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        line = build_user_message_line(text)
        with session.lock:
            session.turn_done.clear()
            session.turn_state = "running"
            session.turn_seq += 1
            session.dispatched_at = time.monotonic()
            session.first_activity_at = None
            session.terminal_at = None
            session.last_activity = ""
            session.observed_tools = []
            session.written_paths = []
            session.turn_line_start = len(session.lines)
            session.last_idempotency_key = idempotency_key
        self._write_stdin(session, line)

    def stop_session(self, session_id: str) -> bool:
        with self._global_lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        if session.proc.poll() is None:
            session.proc.terminate()
            try:
                session.proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                session.proc.kill()
        return True

    def wait_for_turn(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.2,
    ) -> Tuple[str, Dict[str, Any]]:
        """Block until the current turn ends, the child exits, or timeout."""
        session = self.get(session_id)
        if session is None:
            return "unknown_session", {}

        if not session.turn_done.is_set():
            with session.lock:
                pending = list(session.lines[session.turn_line_start :])
            for line in pending:
                session.observe_line(line)
                if session.turn_done.is_set():
                    break

        def _snapshot(status: str, stalled: bool) -> Tuple[str, Dict[str, Any]]:
            # Must not run while holding session.lock: describe_session takes
            # _global_lock then session.lock.
            snap = self.describe_session(session_id) or {}
            snap["status"] = status
            snap["tail"] = session.recent_text()
            snap["stalled"] = stalled
            return status, snap

        if timeout_sec <= 0:
            with session.lock:
                done = session.turn_done.is_set()
                kind = session.last_terminal_kind or "error"
                exited = session.proc.poll() is not None
            if done:
                return _snapshot(kind, False)
            if exited:
                return _snapshot("exited", False)
            return _snapshot("running", False)

        deadline = time.monotonic() + timeout_sec
        with session.lock:
            start_activity_at = session.last_activity_at
            start_line_count = len(session.lines)

        while True:
            with session.lock:
                done = session.turn_done.is_set()
                kind = session.last_terminal_kind or "error"
            if done:
                return _snapshot(kind, False)
            if session.proc.poll() is not None:
                return _snapshot("exited", False)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            session.turn_done.wait(min(poll_interval, remaining))

        with session.lock:
            stalled = (
                session.last_activity_at == start_activity_at
                and len(session.lines) == start_line_count
            )
        return _snapshot("running", stalled)

    def wait_for_success_result(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.2,
    ) -> Tuple[bool, str]:
        """Block until a result/success line appears, timeout, or process exit."""
        status, snap = self.wait_for_turn(session_id, timeout_sec, poll_interval)
        tail = str(snap.get("tail", ""))
        if status == "success":
            return True, tail
        if status == "unknown_session":
            return False, "unknown session"
        if status == "exited":
            return False, f"process exited code={snap.get('exit_code')}\n{tail}"
        if status == "running":
            return False, f"timeout after {timeout_sec}s\n{tail}"
        return False, f"{status}: {snap.get('terminal_detail', '')}\n{tail}"
