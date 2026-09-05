#!/usr/bin/env python3
"""Lazy autostart for the local WB bridge HTTP process.

Mirrors CC-bridge autostart: spawn from the Studio process (full FS access),
never via agent bash sandbox.

Author: Damon Li
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from typing import Optional

from agenticx.wb_bridge import settings as wb_settings
from agenticx.wb_bridge.settings import parse_wb_bridge_url

_WB_BRIDGE_AUTO_PROC: Optional[subprocess.Popen[str]] = None


def wb_bridge_autostart_proc_running() -> bool:
    return _WB_BRIDGE_AUTO_PROC is not None and _WB_BRIDGE_AUTO_PROC.poll() is None


def _listening_pids(port: int) -> list[int]:
    """PIDs listening on TCP ``port``. Empty when the lookup tool is missing."""
    if port <= 0 or port > 65535:
        return []
    if sys.platform == "win32":
        try:
            raw = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                text=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        pids: list[int] = []
        needle = f":{port}"
        for line in raw.splitlines():
            if "LISTENING" not in line.upper() or needle not in line:
                continue
            parts = line.split()
            if not parts:
                continue
            try:
                pid = int(parts[-1])
            except ValueError:
                continue
            if pid > 0 and pid not in pids:
                pids.append(pid)
        return pids
    try:
        raw = subprocess.check_output(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    pids: list[int] = []
    for line in raw.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid > 1 and pid not in pids:
            pids.append(pid)
    return pids


def terminate_loopback_listener(port: int, *, timeout_sec: float = 5.0) -> str:
    """Stop whatever is listening on a loopback TCP port. Never used for remote URLs."""
    pids = _listening_pids(port)
    if not pids:
        return "no_listener"
    for pid in pids:
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/F"],
                    check=False,
                    capture_output=True,
                    timeout=5,
                )
            else:
                os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            continue
    deadline = time.monotonic() + max(0.5, timeout_sec)
    while time.monotonic() < deadline:
        if not _listening_pids(port):
            return f"stopped pids={pids}"
        time.sleep(0.1)
    for pid in _listening_pids(port):
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/F"],
                    check=False,
                    capture_output=True,
                    timeout=5,
                )
            else:
                os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            continue
    return f"killed pids={pids}"


def ensure_wb_bridge_protocol(base_url: str, token: str) -> tuple[bool, str]:
    """Start or recycle loopback serve so ``/health`` reports the current schema.

    Remote / non-loopback URLs are never killed. Token mismatch is left alone.
    """
    global _WB_BRIDGE_AUTO_PROC
    is_loopback, _host, port = parse_wb_bridge_url(base_url)
    probe = wb_settings.probe_wb_bridge(url=base_url, token=token)
    if probe.get("ready") and probe.get("schema_ok"):
        return (True, "already_ready")
    if not is_loopback:
        if probe.get("ready"):
            return (True, "nonlocal_ready_unversioned")
        return (False, "non-loopback URL; skip autostart")
    if probe.get("reachable") and not probe.get("auth_ok"):
        return (False, "skipped_token_mismatch")
    if probe.get("ready") and not probe.get("schema_ok"):
        terminate_loopback_listener(port)
        _WB_BRIDGE_AUTO_PROC = None
        started, detail = ensure_wb_bridge_local_process(base_url, token)
        if started:
            return (True, f"recycled:{detail}")
        return (False, f"recycle_spawn_failed:{detail}")
    return ensure_wb_bridge_local_process(base_url, token)


def ensure_wb_bridge_local_process(base_url: str, token: str) -> tuple[bool, str]:
    """Best-effort lazy autostart for loopback ``agx wb-bridge serve``."""
    global _WB_BRIDGE_AUTO_PROC
    if wb_bridge_autostart_proc_running():
        return (True, "already running")
    is_loopback, host, port = parse_wb_bridge_url(base_url)
    if not is_loopback:
        return (False, "non-loopback URL; skip autostart")

    env = os.environ.copy()
    if token:
        env.setdefault("WB_BRIDGE_TOKEN", token)
        env.setdefault("AGX_WB_BRIDGE_TOKEN", token)

    bind_host = "127.0.0.1" if host in {"localhost", "::1", "[::1]"} else host
    candidates: list[list[str]] = []
    agx_bin = shutil.which("agx")
    if agx_bin:
        candidates.append(
            [agx_bin, "wb-bridge", "serve", "--host", bind_host, "--port", str(port)]
        )
    candidates.append(
        [
            sys.executable,
            "-m",
            "agenticx.cli.main",
            "wb-bridge",
            "serve",
            "--host",
            bind_host,
            "--port",
            str(port),
        ]
    )

    last_err = "unknown"
    for cmd in candidates:
        try:
            _WB_BRIDGE_AUTO_PROC = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
                text=True,
            )
            return (True, f"started pid={_WB_BRIDGE_AUTO_PROC.pid}")
        except Exception as exc:  # pragma: no cover - platform/env specific
            last_err = str(exc)
            continue
    _WB_BRIDGE_AUTO_PROC = None
    return (False, f"failed to spawn bridge process: {last_err}")
