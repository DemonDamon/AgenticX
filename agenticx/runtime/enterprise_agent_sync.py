#!/usr/bin/env python3
"""Register a local avatar with the signed-in enterprise account.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from agenticx.cli.config_manager import ConfigManager

logger = logging.getLogger(__name__)


def _settings() -> tuple[str, str] | None:
    try:
        if ConfigManager.get_value("enterprise.enabled") is not True:
            return None
        token = ConfigManager.get_value("enterprise.token")
        base = ConfigManager.get_value("enterprise.base_url")
    except Exception:
        return None
    if not isinstance(token, str) or not isinstance(base, str):
        return None
    token = token.strip()
    base = base.strip().rstrip("/")
    if not token or not base:
        return None
    return token, base


def sync_local_avatar(avatar: Any) -> None:
    """Best-effort. A desktop expert stays local when enterprise login is off."""

    settings = _settings()
    if settings is None:
        return
    token, base = settings
    avatar_id = str(getattr(avatar, "id", "") or "").strip()
    name = str(getattr(avatar, "name", "") or "").strip()
    if not avatar_id or not name:
        return
    provider = str(getattr(avatar, "default_provider", "") or "").strip()
    model_name = str(getattr(avatar, "default_model", "") or "").strip()
    model = f"{provider}/{model_name}" if provider and model_name else model_name
    try:
        response = httpx.post(
            f"{base}/api/desktop/agents/register",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "local_avatar_id": avatar_id,
                "display_name": name,
                "system_prompt": str(getattr(avatar, "system_prompt", "") or ""),
                "model": model,
                "description": str(getattr(avatar, "description", "") or ""),
            },
            timeout=8.0,
            trust_env=False,
        )
        if response.status_code >= 400:
            logger.warning("enterprise avatar register failed: %s", response.status_code)
    except Exception:
        logger.debug("enterprise avatar register skipped", exc_info=True)


def fetch_published_agents() -> list[dict[str, Any]]:
    settings = _settings()
    if settings is None:
        return []
    token, base = settings
    try:
        response = httpx.get(
            f"{base}/api/desktop/agents",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8.0,
            trust_env=False,
        )
        if response.status_code >= 400:
            return []
        payload = response.json()
        agents = payload.get("agents") if isinstance(payload, dict) else None
        return [item for item in agents if isinstance(item, dict)] if isinstance(agents, list) else []
    except Exception:
        logger.debug("enterprise agent catalog skipped", exc_info=True)
        return []


class EnterpriseCatalogError(Exception):
    """Portal catalog failed for a reason other than logout or not-found."""


def enterprise_login_configured() -> bool:
    """True when enterprise login has both a token and a base URL."""

    return _settings() is not None


def fetch_enterprise_agent_detail(agent_id: str) -> dict[str, Any] | None:
    """GET {base}/api/desktop/agents/{agent_id}. None when logged out or not visible (404).

    Raises EnterpriseCatalogError for other failures so the route can answer 502.
    """

    settings = _settings()
    if settings is None:
        return None
    token, base = settings
    url = f"{base}/api/desktop/agents/{quote(agent_id, safe='')}"
    try:
        response = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=8.0,
            trust_env=False,
        )
    except Exception:
        logger.warning("enterprise agent detail request failed")
        raise EnterpriseCatalogError("network") from None
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        logger.warning("enterprise agent detail status %s", response.status_code)
        raise EnterpriseCatalogError(f"status {response.status_code}")
    try:
        payload = response.json()
    except Exception:
        raise EnterpriseCatalogError("status 200") from None
    if not isinstance(payload, dict):
        raise EnterpriseCatalogError("status 200")
    return payload
