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

from agenticx.cc_bridge.ndjson import (
    build_user_message_line,
    line_looks_like_result_success,
)
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
                with open(self.log_path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except OSError:
                pass


def _reader_thread(session: WbBridgeSession, stream: Any) -> None:
    try:
        for raw in iter(stream.readline, ""):
            if raw == "":
                break
            line = raw.rstrip("\n\r")
            session.append_line(line)
            session.append_log(line)
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
        return {
            "session_id": sid,
            "cwd": s.cwd,
            "pid": s.proc.pid,
            "poll": poll,
            "log_path": s.log_path,
            "state": "running" if running else "stopped",
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

    def send_user_message(self, session_id: str, text: str) -> None:
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        line = build_user_message_line(text)
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

    def wait_for_success_result(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.2,
    ) -> Tuple[bool, str]:
        """Block until a result/success line appears, timeout, or process exit."""
        session = self.get(session_id)
        if session is None:
            return False, "unknown session"
        deadline = time.monotonic() + timeout_sec
        last_count = 0
        while time.monotonic() < deadline:
            if session.done.is_set() and session.proc.poll() is not None:
                with session.lock:
                    all_lines = list(session.lines)
                    tail = session.recent_text()
                for line in all_lines:
                    if line_looks_like_result_success(line):
                        return True, tail
                return False, f"process exited code={session.exit_code}\n{tail}"
            with session.lock:
                chunk = session.lines[last_count:]
                last_count = len(session.lines)
            for line in chunk:
                if line_looks_like_result_success(line):
                    return True, session.recent_text()
            time.sleep(poll_interval)
        return False, f"timeout after {timeout_sec}s\n{session.recent_text()}"
