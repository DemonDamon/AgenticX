#!/usr/bin/env python3
"""Resolved settings for the harness control surface (client + probe).

Mirrors the cc/wb bridge settings contract: URL from env/config, token
from env/config/auto-generate, and a /health + auth probe for supervision.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
from typing import Optional
from urllib.parse import urlparse

from agenticx.cli.config_manager import ConfigManager

_DEFAULT_URL = "http://127.0.0.1:9744"

# Bump on breaking /health contract changes; probes treat mismatch as stale.
HARNESS_SURFACE_HEALTH_SCHEMA = "harness-surface-1"


def harness_surface_base_url() -> str:
    raw = os.environ.get("AGX_HARNESS_SURFACE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    from_yaml = ConfigManager.get_value("harness_surface.url")
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip().rstrip("/")
    return _DEFAULT_URL


def ensure_harness_surface_token_persisted() -> str:
    """Bearer token for harness surface clients.

    Priority: ``AGX_HARNESS_SURFACE_TOKEN`` env (never written to disk) >
    ``harness_surface.token`` in ~/.agenticx/config.yaml > generate,
    persist, return.
    """
    env_tok = os.environ.get("AGX_HARNESS_SURFACE_TOKEN", "").strip()
    if env_tok:
        return env_tok
    try:
        from_yaml = ConfigManager.get_value("harness_surface.token")
    except Exception:
        from_yaml = None
    if isinstance(from_yaml, str) and from_yaml.strip():
        return from_yaml.strip()
    generated = secrets.token_urlsafe(32)
    try:
        ConfigManager.set_value("harness_surface.token", generated)
    except Exception:
        return generated
    return generated


def harness_surface_token() -> str:
    return ensure_harness_surface_token_persisted()


def harness_surface_nonlocal_allowed() -> bool:
    return os.environ.get("AGX_HARNESS_SURFACE_ALLOW_NONLOCAL", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def validate_harness_surface_url(url: str) -> Optional[str]:
    """Return error message when the URL must not be called; else None."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return "invalid AGX_HARNESS_SURFACE_URL"
    host = (parsed.hostname or "").lower()
    if host in {"", "127.0.0.1", "localhost", "::1", "[::1]"}:
        return None
    if harness_surface_nonlocal_allowed():
        return None
    return (
        "Harness surface URL is not loopback; set AGX_HARNESS_SURFACE_ALLOW_NONLOCAL=1 "
        "if you intentionally use SSH tunnel or same-host remote binding."
    )


def probe_harness_surface(
    *,
    url: Optional[str] = None,
    token: Optional[str] = None,
) -> dict:
    """Check whether ``agx harness-surface serve`` is listening + authed."""
    try:
        import httpx
    except ImportError:
        return {
            "ok": False,
            "url": (url or harness_surface_base_url()).rstrip("/"),
            "reachable": False,
            "auth_ok": False,
            "ready": False,
            "detail": "httpx is required",
        }

    base = (url or harness_surface_base_url()).rstrip("/")
    tok = token if token is not None else harness_surface_token()
    parsed = urlparse(base)
    host = (parsed.hostname or "").lower()
    is_loopback = host in {"127.0.0.1", "localhost", "::1", "[::1]"}
    kwargs: dict = {"timeout": 2.0, "trust_env": False}
    if is_loopback:
        kwargs["transport"] = httpx.HTTPTransport()

    reachable = False
    auth_ok = False
    schema = ""
    schema_ok = False
    detail = "connection refused"
    try:
        with httpx.Client(**kwargs) as client:
            health = client.get(f"{base}/health")
            reachable = health.status_code == 200
            if not reachable:
                detail = f"health HTTP {health.status_code}"
            else:
                try:
                    payload = health.json()
                except Exception:
                    payload = None
                if isinstance(payload, dict):
                    schema = str(payload.get("schema") or "").strip()
                    schema_ok = schema == HARNESS_SURFACE_HEALTH_SCHEMA
                harnesses = client.get(
                    f"{base}/v1/harnesses",
                    headers={"Authorization": f"Bearer {tok}"},
                )
                auth_ok = harnesses.status_code == 200
                detail = "ready" if auth_ok else f"auth HTTP {harnesses.status_code}"
    except httpx.ConnectError:
        detail = "connection refused"
    except Exception as exc:  # pragma: no cover - network/env specific
        detail = str(exc)[:300]

    return {
        "ok": True,
        "url": base,
        "reachable": reachable,
        "auth_ok": auth_ok,
        "schema": schema,
        "schema_ok": schema_ok,
        "ready": bool(reachable and auth_ok),
        "detail": detail,
    }
