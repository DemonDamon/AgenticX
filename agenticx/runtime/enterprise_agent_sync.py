#!/usr/bin/env python3
"""Register a local avatar with the signed-in enterprise account.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any

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
