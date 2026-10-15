#!/usr/bin/env python3
"""Local status and switch for the enterprise desktop worker.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import FastAPI, Header
from pydantic import BaseModel

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_agent_sync import fetch_published_agents
from agenticx.runtime.enterprise_worker import worker_enabled


class EnterpriseWorkerToggle(BaseModel):
    enabled: bool


def _worker_status(worker: Any) -> dict[str, Any]:
    status = worker.status()
    if isinstance(status, dict):
        return status
    return {"enabled": worker_enabled(), "running": False}


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
        ConfigManager.set_value("enterprise.worker.enabled", bool(payload.enabled))
        worker = getattr(app.state, "enterprise_worker", None)
        if worker is None:
            return {"enabled": worker_enabled(), "running": False}
        return _worker_status(worker)
