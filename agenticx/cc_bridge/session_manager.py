#!/usr/bin/env python3
"""Subprocess sessions for local Claude Code bridge.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from agenticx.cc_bridge.ndjson import (
    build_control_response_allow,
    build_control_response_deny,
    build_user_message_line,
    line_looks_like_result_success,
    parse_control_request,
)

_LOG = logging.getLogger(__name__)


def _env_truthy(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class BridgeSession:
    session_id: str
    cwd: str
    proc: subprocess.Popen[str]
    lines: List[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    done: threading.Event = field(default_factory=threading.Event)
    exit_code: Optional[int] = None
    auto_allow: bool = False

    def append_line(self, line: str) -> None:
        with self.lock:
            self.lines.append(line)
            if len(self.lines) > 2000:
                self.lines = self.lines[-2000:]

    def recent_text(self, max_lines: int = 80) -> str:
        with self.lock:
            chunk = self.lines[-max_lines:]
        return "\n".join(chunk)


def _reader_thread(
    session: BridgeSession,
    stream: Any,
    on_control_request: Callable[[BridgeSession, Dict[str, Any]], None],
) -> None:
    try:
        for raw in iter(stream.readline, ""):
            if raw == "":
                break
            line = raw.rstrip("\n\r")
            session.append_line(line)
            req = parse_control_request(line)
            if req is not None:
                on_control_request(session, req)
    finally:
        try:
            stream.close()
        except OSError:
            pass


def _stderr_thread(session: BridgeSession, stream: Any) -> None:
    try:
        for raw in iter(stream.readline, ""):
            if raw == "":
                break
            session.append_line("[stderr] " + raw.rstrip("\n\r"))
    finally:
        try:
            stream.close()
        except OSError:
            pass


class BridgeSessionManager:
    """Owns CC child processes and stdout/stdin wiring."""

    def __init__(self) -> None:
        self._sessions: Dict[str, BridgeSession] = {}
        self._global_lock = threading.Lock()

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._global_lock:
            out = []
            for sid, s in self._sessions.items():
                out.append(
                    {
                        "session_id": sid,
                        "cwd": s.cwd,
                        "pid": s.proc.pid,
                        "poll": s.proc.poll(),
                    }
                )
            return out

    def get(self, session_id: str) -> Optional[BridgeSession]:
        with self._global_lock:
            return self._sessions.get(session_id)

    def _on_control_request(self, session: BridgeSession, req: Dict[str, Any]) -> None:
        if not session.auto_allow:
            return
        request_id = str(req.get("request_id") or "")
        inner = req.get("request")
        if not isinstance(inner, dict) or not request_id:
            return
        tool_input = inner.get("input")
        if not isinstance(tool_input, dict):
            tool_input = {}
        tool_use_id = inner.get("tool_use_id")
        tid = str(tool_use_id) if tool_use_id is not None else None
        line = build_control_response_allow(request_id, tool_input, tid)
        self._write_stdin(session, line)

    def _write_stdin(self, session: BridgeSession, data: str) -> None:
        if session.proc.stdin is None:
            return
        try:
            session.proc.stdin.write(data)
            session.proc.stdin.flush()
        except BrokenPipeError:
            _LOG.warning("stdin broken for session %s", session.session_id)
        except OSError as exc:
            _LOG.warning("stdin write failed session=%s err=%s", session.session_id, exc)

    def start_session(
        self,
        cwd: str,
        *,
        auto_allow_permissions: Optional[bool] = None,
    ) -> BridgeSession:
        exe = os.environ.get("CC_BRIDGE_EXECUTABLE", "claude").strip() or "claude"
        if auto_allow_permissions is None:
            auto_allow_permissions = _env_truthy("CC_BRIDGE_AUTO_ALLOW_PERMISSIONS", "0")

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
            "--permission-prompt-tool",
            "stdio",
        ]

        env = os.environ.copy()
        env.setdefault("CLAUDE_CODE_ENVIRONMENT_KIND", "agx_cc_bridge")

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
        session = BridgeSession(
            session_id=sid,
            cwd=str(path),
            proc=proc,
            auto_allow=bool(auto_allow_permissions),
        )

        assert proc.stdout is not None
        assert proc.stderr is not None

        threading.Thread(
            target=_reader_thread,
            args=(session, proc.stdout, self._on_control_request),
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

    def _wait_proc(self, session: BridgeSession) -> None:
        code = session.proc.wait()
        session.exit_code = code
        session.done.set()

    def send_user_message(self, session_id: str, text: str) -> None:
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        line = build_user_message_line(text)
        self._write_stdin(session, line)

    def respond_permission(
        self,
        session_id: str,
        request_id: str,
        allow: bool,
        *,
        tool_input: Optional[Dict[str, Any]] = None,
        tool_use_id: Optional[str] = None,
        deny_message: str = "Denied by operator",
    ) -> None:
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        if allow:
            inp = tool_input if isinstance(tool_input, dict) else {}
            line = build_control_response_allow(request_id, inp, tool_use_id)
        else:
            line = build_control_response_deny(request_id, deny_message, tool_use_id)
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
        import time

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
