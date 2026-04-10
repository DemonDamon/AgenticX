#!/usr/bin/env python3
"""Subprocess sessions for local Claude Code bridge.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import queue
import subprocess
import threading
import time
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
from agenticx.cc_bridge.tui_parser import ANCHOR_PREFIX, monotonic_now, parse_visible_tui_tail

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
    log_path: str = ""
    log_lock: threading.Lock = field(default_factory=threading.Lock)
    session_kind: str = "headless"  # headless | visible_tui
    pty_master_fd: Optional[int] = None
    pty_listeners: List[queue.Queue[Optional[bytes]]] = field(default_factory=list)
    pty_listener_lock: threading.Lock = field(default_factory=threading.Lock)
    _last_tui_anchor: str = field(default="", repr=False)
    _tui_send_started: float = field(default=0.0, repr=False)
    _tui_last_line_count: int = field(default=0, repr=False)
    _tui_last_activity_mono: float = field(default=0.0, repr=False)

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
            session.append_log(line)
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
            line = "[stderr] " + raw.rstrip("\n\r")
            session.append_line(line)
            session.append_log(line)
    finally:
        try:
            stream.close()
        except OSError:
            pass


def _broadcast_pty_chunk(session: BridgeSession, chunk: bytes) -> None:
    if not chunk:
        return
    with session.pty_listener_lock:
        listeners = list(session.pty_listeners)
    for qobj in listeners:
        try:
            qobj.put_nowait(chunk)
        except queue.Full:
            try:
                _ = qobj.get_nowait()
            except queue.Empty:
                pass
            try:
                qobj.put_nowait(chunk)
            except queue.Full:
                pass


def _close_all_pty_listeners(session: BridgeSession) -> None:
    with session.pty_listener_lock:
        for qobj in session.pty_listeners:
            try:
                qobj.put_nowait(None)
            except Exception:
                pass
        session.pty_listeners.clear()


def _pty_reader_thread(session: BridgeSession, master_fd: int) -> None:
    line_buf = b""
    try:
        while True:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            _broadcast_pty_chunk(session, chunk)
            line_buf += chunk
            while b"\n" in line_buf:
                raw_line, line_buf = line_buf.split(b"\n", 1)
                try:
                    s = raw_line.decode("utf-8", errors="replace")
                except Exception:
                    s = str(raw_line)
                session.append_line(s)
                session.append_log(s)
        if line_buf:
            try:
                s = line_buf.decode("utf-8", errors="replace")
            except Exception:
                s = str(line_buf)
            if s.strip():
                session.append_line(s)
                session.append_log(s)
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        _close_all_pty_listeners(session)


class BridgeSessionManager:
    """Owns CC child processes and stdout/stdin wiring."""

    def __init__(self) -> None:
        self._sessions: Dict[str, BridgeSession] = {}
        self._global_lock = threading.Lock()

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._global_lock:
            out = []
            for sid, s in self._sessions.items():
                out.append(self._session_to_dict(sid, s))
            return out

    def describe_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Return authoritative mode/cwd/state for a single session (or None if unknown)."""
        with self._global_lock:
            s = self._sessions.get(session_id)
            if s is None:
                return None
            return self._session_to_dict(session_id, s)

    def _session_to_dict(self, sid: str, s: BridgeSession) -> Dict[str, Any]:
        poll = s.proc.poll()
        running = poll is None
        return {
            "session_id": sid,
            "cwd": s.cwd,
            "pid": s.proc.pid,
            "poll": poll,
            "log_path": s.log_path,
            "mode": s.session_kind,
            "state": "running" if running else "stopped",
            "interactive_waiting": bool(s.session_kind == "visible_tui" and running),
        }

    def get(self, session_id: str) -> Optional[BridgeSession]:
        with self._global_lock:
            return self._sessions.get(session_id)

    def _on_control_request(self, session: BridgeSession, req: Dict[str, Any]) -> None:
        if session.session_kind == "visible_tui":
            return
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
        if session.pty_master_fd is not None:
            try:
                os.write(session.pty_master_fd, data.encode("utf-8", errors="replace"))
            except BrokenPipeError:
                _LOG.warning("pty stdin broken for session %s", session.session_id)
            except OSError as exc:
                _LOG.warning("pty write failed session=%s err=%s", session.session_id, exc)
            return
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
        mode: str = "headless",
    ) -> BridgeSession:
        if mode not in {"headless", "visible_tui"}:
            mode = "headless"
        if mode == "visible_tui":
            return self._start_session_visible_tui(cwd, auto_allow_permissions=auto_allow_permissions)
        return self._start_session_headless(cwd, auto_allow_permissions=auto_allow_permissions)

    def _log_path_for_sid(self, sid: str) -> str:
        log_dir = Path(os.environ.get("CC_BRIDGE_LOG_DIR", "~/.agenticx/logs/cc-bridge")).expanduser()
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            return str((log_dir / f"{sid}.log").resolve())
        except OSError:
            return ""

    def _start_session_headless(
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
        log_path = self._log_path_for_sid(sid)
        session = BridgeSession(
            session_id=sid,
            cwd=str(path),
            proc=proc,
            auto_allow=bool(auto_allow_permissions),
            log_path=log_path,
            session_kind="headless",
        )
        session.append_log(f"[bridge] started headless session_id={sid} pid={proc.pid} cwd={path}")

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

    def _start_session_visible_tui(
        self,
        cwd: str,
        *,
        auto_allow_permissions: Optional[bool] = None,
    ) -> BridgeSession:
        try:
            import pty  # noqa: F401
        except ImportError as exc:
            raise RuntimeError("visible_tui requires Unix PTY (not available on this platform)") from exc

        _ = auto_allow_permissions  # TUI: interactive permission in terminal; NDJSON auto_allow N/A
        exe = os.environ.get("CC_BRIDGE_EXECUTABLE", "claude").strip() or "claude"
        path = Path(cwd).resolve()
        path.mkdir(parents=True, exist_ok=True)

        master_fd, slave_fd = pty.openpty()
        try:
            master_write_fd = os.dup(master_fd)
        except OSError as exc:
            os.close(master_fd)
            os.close(slave_fd)
            raise RuntimeError("failed to dup pty master for writes") from exc

        env = os.environ.copy()
        env.setdefault("CLAUDE_CODE_ENVIRONMENT_KIND", "agx_cc_bridge")
        env.setdefault("TERM", "xterm-256color")

        proc = subprocess.Popen(
            [exe],
            cwd=str(path),
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            close_fds=False,
        )
        os.close(slave_fd)
        if proc.stdin:
            try:
                proc.stdin.close()
            except OSError:
                pass

        sid = str(uuid.uuid4())
        log_path = self._log_path_for_sid(sid)
        session = BridgeSession(
            session_id=sid,
            cwd=str(path),
            proc=proc,
            auto_allow=False,
            log_path=log_path,
            session_kind="visible_tui",
            pty_master_fd=master_write_fd,
        )
        session.append_log(f"[bridge] started visible_tui session_id={sid} pid={proc.pid} cwd={path}")

        threading.Thread(
            target=_pty_reader_thread,
            args=(session, master_fd),
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
        _close_all_pty_listeners(session)
        if session.pty_master_fd is not None:
            try:
                os.close(session.pty_master_fd)
            except OSError:
                pass
            session.pty_master_fd = None

    def send_user_message(self, session_id: str, text: str) -> None:
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        if session.session_kind == "visible_tui":
            anchor = f"{ANCHOR_PREFIX} {uuid.uuid4().hex}"
            session._last_tui_anchor = anchor
            session._tui_send_started = monotonic_now()
            session._tui_last_line_count = len(session.lines)
            session._tui_last_activity_mono = session._tui_send_started
            session.append_line(anchor)
            session.append_log(anchor)
            self._write_stdin(session, text + "\r")
            return
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
        if session.session_kind == "visible_tui":
            raise KeyError("permission API not supported for visible_tui; approve in TUI")
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
        _close_all_pty_listeners(session)
        if session.pty_master_fd is not None:
            try:
                os.close(session.pty_master_fd)
            except OSError:
                pass
            session.pty_master_fd = None
        if session.proc.poll() is None:
            session.proc.terminate()
            try:
                session.proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                session.proc.kill()
        return True

    def iter_pty_stream_chunks(self, session_id: str):
        """Yield raw PTY output for visible_tui; blocks until session ends or client disconnects."""
        session = self.get(session_id)
        if session is None or session.session_kind != "visible_tui":
            return
        qobj: queue.Queue[Optional[bytes]] = queue.Queue(maxsize=512)
        with session.pty_listener_lock:
            session.pty_listeners.append(qobj)
        try:
            while True:
                item = qobj.get()
                if item is None:
                    break
                yield item
        finally:
            with session.pty_listener_lock:
                try:
                    session.pty_listeners.remove(qobj)
                except ValueError:
                    pass

    def write_pty_raw(self, session_id: str, data: str) -> None:
        """Write user keystrokes / paste to visible_tui PTY (no Machi anchor)."""
        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        if session.session_kind != "visible_tui":
            raise ValueError("write_pty_raw only for visible_tui sessions")
        if session.pty_master_fd is None:
            raise KeyError("pty closed")
        self._write_stdin(session, data)

    def resize_pty_session(self, session_id: str, rows: int, cols: int) -> None:
        """Propagate terminal size to the PTY (visible_tui only)."""
        import fcntl
        import struct
        import termios

        session = self.get(session_id)
        if session is None:
            raise KeyError("unknown session")
        if session.session_kind != "visible_tui":
            raise ValueError("resize_pty_session only for visible_tui sessions")
        fd = session.pty_master_fd
        if fd is None:
            raise KeyError("pty closed")
        r = max(2, min(200, int(rows)))
        c = max(2, min(300, int(cols)))
        winsize = struct.pack("HHHH", r, c, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

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

    def wait_for_visible_tui_result(
        self,
        session_id: str,
        timeout_sec: float,
        poll_interval: float = 0.25,
    ) -> Tuple[bool, str, float, str]:
        """Wait for idle-stabilized TUI transcript after last anchor. Returns (ok, parsed, confidence, tail)."""
        session = self.get(session_id)
        if session is None:
            return False, "", 0.0, "unknown session"
        anchor = session._last_tui_anchor
        if not anchor:
            return False, "", 0.0, "missing tui anchor"
        send_t0 = session._tui_send_started
        deadline = time.monotonic() + timeout_sec
        last_line_count = session._tui_last_line_count
        last_activity = session._tui_last_activity_mono
        best_text = ""
        best_conf = 0.0
        last_reason = "waiting"

        while time.monotonic() < deadline:
            now = monotonic_now()
            with session.lock:
                n = len(session.lines)
                all_lines = list(session.lines)
                tail = session.recent_text()
            if n > last_line_count:
                last_line_count = n
                last_activity = now
            idle = now - last_activity
            pr = parse_visible_tui_tail(
                all_lines,
                anchor,
                idle_seconds=idle,
                max_wait_seconds=timeout_sec,
                started_monotonic=send_t0,
                now_monotonic=now,
            )
            last_reason = pr.reason
            if pr.text and pr.confidence >= best_conf:
                best_text = pr.text
                best_conf = pr.confidence
            if session.done.is_set() and session.proc.poll() is not None:
                break
            if best_text and idle >= 2.0 and best_conf >= 0.65:
                return True, best_text, best_conf, tail
            if best_text and idle >= 4.0:
                return True, best_text, best_conf, tail
            time.sleep(poll_interval)

        with session.lock:
            tail = session.recent_text()
            all_lines = list(session.lines)
        now = monotonic_now()
        idle = now - last_activity
        pr = parse_visible_tui_tail(
            all_lines,
            anchor,
            idle_seconds=idle,
            max_wait_seconds=timeout_sec,
            started_monotonic=send_t0,
            now_monotonic=now,
        )
        if pr.text:
            best_text = pr.text
            best_conf = max(best_conf, pr.confidence)
        ok = bool(best_text.strip())
        return ok, best_text, best_conf, tail if ok else f"{last_reason}\n{tail}"
