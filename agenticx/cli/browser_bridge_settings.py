#!/usr/bin/env python3
"""Resolved settings for Near WorkPanel browser-bridge HTTP client.

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path

MISSING_BRIDGE_ERROR = (
    "Near 桌面端未运行或浏览器桥未启动（缺少 ~/.agenticx/browser_bridge.port）"
)


def _agenticx_dir() -> Path:
    return Path.home() / ".agenticx"


def browser_bridge_base_url() -> str:
    raw = os.environ.get("AGX_BROWSER_BRIDGE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    port_file = _agenticx_dir() / "browser_bridge.port"
    try:
        port = port_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if not port.isdigit():
        return ""
    return f"http://127.0.0.1:{port}"


def browser_bridge_token() -> str:
    raw = os.environ.get("AGX_BROWSER_BRIDGE_TOKEN", "").strip()
    if raw:
        return raw
    token_file = _agenticx_dir() / "browser_bridge.token"
    try:
        return token_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
