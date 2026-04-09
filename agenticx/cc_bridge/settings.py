#!/usr/bin/env python3
"""Resolved settings for CC bridge HTTP client (Studio tools).

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Optional
from urllib.parse import urlparse

from agenticx.cli.config_manager import ConfigManager

_DEFAULT_URL = "http://127.0.0.1:9742"


def cc_bridge_base_url() -> str:
    raw = os.environ.get("AGX_CC_BRIDGE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    from_yaml = ConfigManager.get_value("cc_bridge.url")
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip().rstrip("/")
    return _DEFAULT_URL


def cc_bridge_token() -> str:
    raw = os.environ.get("AGX_CC_BRIDGE_TOKEN", "").strip()
    if raw:
        return raw
    from_yaml = ConfigManager.get_value("cc_bridge.token")
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip()
    return ""


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
