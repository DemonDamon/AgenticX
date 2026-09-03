#!/usr/bin/env python3
"""Lazy autostart for the local WB bridge HTTP process.

Mirrors CC-bridge autostart: spawn from the Studio process (full FS access),
never via agent bash sandbox.

Author: Damon Li
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import Optional

from agenticx.wb_bridge.settings import parse_wb_bridge_url

_WB_BRIDGE_AUTO_PROC: Optional[subprocess.Popen[str]] = None


def wb_bridge_autostart_proc_running() -> bool:
    return _WB_BRIDGE_AUTO_PROC is not None and _WB_BRIDGE_AUTO_PROC.poll() is None


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
