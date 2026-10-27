#!/usr/bin/env python3
"""Local status and switch for the enterprise desktop worker.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Callable, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_agent_publish import (
    EnterprisePublishError,
    build_publish_manifest,
    enterprise_publish_settings,
    load_global_tools_enabled,
    publish_avatar_draft,
)
from agenticx.runtime.enterprise_agent_sync import (
    EnterpriseCatalogError,
    enterprise_login_configured,
    fetch_enterprise_agent_detail,
    fetch_published_agents,
)
from agenticx.runtime.enterprise_worker import (
    INTERACTIVE_ENV_TTL_S,
    enterprise_login_settings,
    worker_enabled,
)


class EnterpriseWorkerToggle(BaseModel):
    enabled: Optional[bool] = None
    ma_enabled: Optional[bool] = None


class InteractiveEnvironmentRequest(BaseModel):
    environment_id: str = Field(min_length=1, max_length=64)


class EnterprisePublishRequest(BaseModel):
    dry_run: bool = True
    note: Optional[str] = Field(default=None, max_length=500)


def _worker_status(worker: Any) -> dict[str, Any]:
    status = worker.status()
    if isinstance(status, dict):
        return status
    return {"enabled": worker_enabled(), "running": False}


_AGENT_ID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def register_enterprise_worker_routes(
    app: FastAPI,
    check_token: Callable[[Optional[str]], None],
) -> None:
    """Attach the local enterprise worker status and enable routes."""

    @app.get("/api/enterprise-agents")
    async def list_published_enterprise_agents(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        return {"agents": fetch_published_agents()}

    @app.get("/api/enterprise-agents/{agent_id}")
    async def get_enterprise_agent(
        agent_id: str,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        if not _AGENT_ID_RE.match(agent_id):
            raise HTTPException(status_code=400, detail="invalid agent id")
        if not enterprise_login_configured():
            raise HTTPException(status_code=409, detail="enterprise_login_required")
        try:
            detail = await asyncio.to_thread(fetch_enterprise_agent_detail, agent_id)
        except EnterpriseCatalogError:
            raise HTTPException(status_code=502, detail="enterprise unavailable") from None
        if detail is None:
            raise HTTPException(status_code=404, detail="enterprise agent not found")
        return detail

    @app.get("/api/enterprise-worker/status")
    async def enterprise_worker_status(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        worker = getattr(app.state, "enterprise_worker", None)
        if worker is None:
            return {"enabled": False, "running": False}
        return _worker_status(worker)

    @app.put("/api/enterprise-worker")
    async def put_enterprise_worker(
        payload: EnterpriseWorkerToggle,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        if payload.enabled is None and payload.ma_enabled is None:
            raise HTTPException(status_code=400, detail="enabled or ma_enabled is required")
        if payload.enabled is not None:
            ConfigManager.set_value("enterprise.worker.enabled", bool(payload.enabled))
        if payload.ma_enabled is True:
            ConfigManager.set_value("enterprise.worker.protocol", "dual")
            ConfigManager.set_value("enterprise.worker.ma_environment_mode", "auto")
        elif payload.ma_enabled is False:
            ConfigManager.set_value("enterprise.worker.protocol", "legacy")
        worker = getattr(app.state, "enterprise_worker", None)
        if worker is None:
            return {"enabled": worker_enabled(), "running": False}
        return _worker_status(worker)

    @app.post("/api/enterprise-worker/interactive-environments")
    async def post_interactive_environment(
        payload: InteractiveEnvironmentRequest,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        if enterprise_login_settings() is None:
            raise HTTPException(status_code=409, detail="enterprise_login_required")
        worker = getattr(app.state, "enterprise_worker", None)
        if worker is None:
            raise HTTPException(status_code=503, detail="enterprise_worker_unavailable")
        try:
            worker.add_interactive_environment(payload.environment_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid environment id") from None
        return {
            "ok": True,
            "environment_id": payload.environment_id,
            "expires_in": INTERACTIVE_ENV_TTL_S,
        }

    @app.post("/api/avatars/{avatar_id}/enterprise-publish")
    async def publish_avatar_to_enterprise(
        avatar_id: str,
        payload: EnterprisePublishRequest,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        avatar = AvatarRegistry().get_avatar(avatar_id)
        if avatar is None:
            raise HTTPException(status_code=404, detail="avatar not found")
        settings = enterprise_publish_settings()
        if settings is None:
            raise HTTPException(status_code=409, detail="enterprise_login_required")
        manifest, report = build_publish_manifest(
            avatar,
            global_tools_enabled=load_global_tools_enabled(),
        )
        if report.errors:
            return {
                "ok": False,
                "error": "manifest_invalid",
                "message": report.errors[0],
                "manifest": manifest,
                "report": report.to_dict(),
            }
        if payload.dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "manifest": manifest,
                "report": report.to_dict(),
            }
        try:
            result = await asyncio.to_thread(
                publish_avatar_draft,
                avatar,
                manifest,
                (payload.note or "").strip() or None,
                settings=settings,
            )
        except EnterprisePublishError as err:
            return {
                "ok": False,
                "error": "publish_failed",
                "message": f"HTTP {err.status} · {err.message}" if err.status else err.message,
                "status": err.status,
                "errors": err.errors,
                "report": report.to_dict(),
            }
        return {
            "ok": True,
            "dry_run": False,
            "manifest": manifest,
            "report": report.to_dict(),
            "result": result,
        }
