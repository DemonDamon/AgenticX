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


def parse_wb_bridge_url(base_url: str) -> Tuple[bool, str, int]:
    """Return ``(is_loopback, host, port)``; missing port defaults to 9743."""
    try:
        parsed = urlparse(base_url)
    except ValueError:
        return (False, "127.0.0.1", 9743)
    host = (parsed.hostname or "").strip().lower()
    try:
        port = int(parsed.port or 9743)
    except (TypeError, ValueError):
        port = 9743
    is_loopback = host in {"127.0.0.1", "localhost", "::1", "[::1]"}
    return (is_loopback, host or "127.0.0.1", port)


def probe_wb_bridge(*, url: Optional[str] = None, token: Optional[str] = None) -> dict:
    """Check whether ``agx wb-bridge serve`` is listening and the token matches.

    ``reachable``: process answered ``GET /health``.
    ``auth_ok``: ``GET /v1/sessions`` accepted the bearer token.
    ``ready``: both true.
    """
    try:
        import httpx
    except ImportError:
        return {
            "ok": False,
            "url": (url or wb_bridge_base_url()).rstrip("/"),
            "reachable": False,
            "auth_ok": False,
            "ready": False,
            "detail": "httpx is required",
        }

    base = (url or wb_bridge_base_url()).rstrip("/")
    tok = token if token is not None else wb_bridge_token()
    is_loopback, _host, _port = parse_wb_bridge_url(base)
    kwargs: dict = {"timeout": 2.0, "trust_env": False}
    if is_loopback:
        kwargs["transport"] = httpx.HTTPTransport()

    reachable = False
    auth_ok = False
    detail = "connection refused"
    try:
        with httpx.Client(**kwargs) as client:
            health = client.get(f"{base}/health")
            reachable = health.status_code == 200
            if not reachable:
                detail = f"health HTTP {health.status_code}"
            else:
                sessions = client.get(
                    f"{base}/v1/sessions",
                    headers={"Authorization": f"Bearer {tok}"},
                )
                auth_ok = sessions.status_code == 200
                if auth_ok:
                    detail = "ready"
                else:
                    detail = f"auth HTTP {sessions.status_code}"
    except httpx.ConnectError:
        detail = "connection refused"
    except Exception as exc:  # pragma: no cover - network/env specific
        detail = str(exc)[:300]

    return {
        "ok": True,
        "url": base,
        "reachable": reachable,
        "auth_ok": auth_ok,
        "ready": bool(reachable and auth_ok),
        "detail": detail,
    }


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
