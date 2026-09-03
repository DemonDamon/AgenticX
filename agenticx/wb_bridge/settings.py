#!/usr/bin/env python3
"""Resolved settings for WB bridge HTTP client (Studio tools).

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
import shutil
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse

from agenticx.cli.config_manager import ConfigManager

_DEFAULT_URL = "http://127.0.0.1:9743"

# Fixed app-bundle candidates. Never include standalone "wb" (Weights & Biases).
CODEBUDDY_PATH_CANDIDATES: Tuple[str, ...] = (
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
    str(
        Path.home()
        / "Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"
    ),
)
CODEBUDDY_WHICH_NAMES: Tuple[str, ...] = ("codebuddy", "cbc")


def wb_bridge_base_url() -> str:
    raw = os.environ.get("AGX_WB_BRIDGE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    from_yaml = ConfigManager.get_value("wb_bridge.url")
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip().rstrip("/")
    return _DEFAULT_URL


def ensure_wb_bridge_token_persisted() -> str:
    """Return bearer token for Studio WB bridge HTTP client.

    Priority: ``AGX_WB_BRIDGE_TOKEN`` env (never written to disk) >
    ``wb_bridge.token`` in ~/.agenticx/config.yaml > generate, persist, return.
    """
    env_tok = os.environ.get("AGX_WB_BRIDGE_TOKEN", "").strip()
    if env_tok:
        return env_tok
    try:
        from_yaml = ConfigManager.get_value("wb_bridge.token")
    except Exception:
        from_yaml = None
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip()
    generated = secrets.token_urlsafe(32)
    ConfigManager.set_value("wb_bridge.token", generated)
    return generated


def wb_bridge_token() -> str:
    """Resolved token for bridge HTTP calls (may persist a new token on first use)."""
    return ensure_wb_bridge_token_persisted()


def wb_bridge_nonlocal_allowed() -> bool:
    return os.environ.get("AGX_WB_BRIDGE_ALLOW_NONLOCAL", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def validate_bridge_url_for_studio(url: str) -> Optional[str]:
    """Return error message if Studio must not call this URL; else None."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return "invalid AGX_WB_BRIDGE_URL"
    host = (parsed.hostname or "").lower()
    if host in {"", "127.0.0.1", "localhost", "::1", "[::1]"}:
        return None
    if wb_bridge_nonlocal_allowed():
        return None
    return (
        "WB bridge URL is not loopback; set AGX_WB_BRIDGE_ALLOW_NONLOCAL=1 "
        "if you intentionally use SSH tunnel or same-host remote binding."
    )


def resolve_codebuddy_executable() -> str:
    """Resolve the CodeBuddy CLI binary. Never falls back to ``wb``."""
    env_exe = os.environ.get("AGX_WB_BRIDGE_EXECUTABLE", "").strip()
    if env_exe:
        return env_exe

    try:
        from_yaml = ConfigManager.get_value("wb_bridge.executable")
    except Exception:
        from_yaml = None
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip()

    for raw in CODEBUDDY_PATH_CANDIDATES:
        path = Path(raw).expanduser()
        if os.access(str(path), os.X_OK):
            return str(path)

    for name in CODEBUDDY_WHICH_NAMES:
        found = shutil.which(name)
        if found:
            return found

    raise RuntimeError(
        "未找到 codebuddy 可执行文件，请安装 WorkBuddy 客户端或设置 AGX_WB_BRIDGE_EXECUTABLE"
    )
