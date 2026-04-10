#!/usr/bin/env python3
"""Resolved settings for CC bridge HTTP client (Studio tools).

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
from typing import Optional
from urllib.parse import urlparse

from agenticx.cli.config_manager import ConfigManager

_DEFAULT_URL = "http://127.0.0.1:9742"

_CC_BRIDGE_MODES = frozenset({"headless", "visible_tui"})


def cc_bridge_mode_env_override() -> Optional[str]:
    """Return env override mode if explicitly set and valid, else None."""
    raw = os.environ.get("AGX_CC_BRIDGE_MODE", "").strip().lower()
    if raw in _CC_BRIDGE_MODES:
        return raw
    return None


def cc_bridge_mode_configured() -> Optional[str]:
    """Return persisted config mode from yaml, without env override."""
    try:
        from_yaml = ConfigManager.get_value("cc_bridge.mode")
    except Exception:
        from_yaml = None
    if isinstance(from_yaml, str):
        m = from_yaml.strip().lower()
        if m in _CC_BRIDGE_MODES:
            return m
    return None


def cc_bridge_mode() -> str:
    """Global CC bridge session mode: headless (stream-json) or visible_tui (interactive PTY)."""
    env_m = cc_bridge_mode_env_override()
    if env_m:
        return env_m
    cfg_m = cc_bridge_mode_configured()
    if cfg_m:
        return cfg_m
    return "headless"


def cc_bridge_base_url() -> str:
    raw = os.environ.get("AGX_CC_BRIDGE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    from_yaml = ConfigManager.get_value("cc_bridge.url")
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip().rstrip("/")
    return _DEFAULT_URL


def ensure_cc_bridge_token_persisted() -> str:
    """Return bearer token for Studio CC bridge HTTP client.

    Priority: ``AGX_CC_BRIDGE_TOKEN`` env (never written to disk) >
    ``cc_bridge.token`` in ~/.agenticx/config.yaml > generate, persist, return.
    """
    env_tok = os.environ.get("AGX_CC_BRIDGE_TOKEN", "").strip()
    if env_tok:
        return env_tok
    try:
        from_yaml = ConfigManager.get_value("cc_bridge.token")
    except Exception:
        from_yaml = None
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip()
    generated = secrets.token_urlsafe(32)
    ConfigManager.set_cc_bridge_field("token", generated)
    return generated


def cc_bridge_token() -> str:
    """Resolved token for bridge HTTP calls (may persist a new token on first use)."""
    return ensure_cc_bridge_token_persisted()


def cc_bridge_nonlocal_allowed() -> bool:
    return os.environ.get("AGX_CC_BRIDGE_ALLOW_NONLOCAL", "").strip().lower() in {
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
        return "invalid AGX_CC_BRIDGE_URL"
    host = (parsed.hostname or "").lower()
    if host in {"", "127.0.0.1", "localhost", "::1", "[::1]"}:
        return None
    if cc_bridge_nonlocal_allowed():
        return None
    return (
        "CC bridge URL is not loopback; set AGX_CC_BRIDGE_ALLOW_NONLOCAL=1 "
        "if you intentionally use SSH tunnel or same-host remote binding."
    )
