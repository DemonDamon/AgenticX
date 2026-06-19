#!/usr/bin/env python3
"""REST handlers for delivery tasks.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import Header, HTTPException

from agenticx.delivery.config import get_delivery_config
from agenticx.delivery.orchestrator import DeliveryOrchestrator, TaskSpec

logger = logging.getLogger("agenticx.studio.delivery_api")

_orchestrator: DeliveryOrchestrator | None = None


def _orch() -> DeliveryOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = DeliveryOrchestrator()
    return _orchestrator


def register_delivery_routes(app: Any, check_token: Callable[[str | None], None]) -> None:
    """Attach /api/delivery/* routes to the Studio FastAPI app."""

    @app.get("/api/delivery/config")
    async def get_delivery_settings(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        cfg = get_delivery_config()
        return {
            "ok": True,
            "enabled": bool(cfg.get("enabled", True)),
            "worktree_root": cfg.get("worktree_root"),
            "bundle_source": cfg.get("bundle_source"),
            "playwright_browsers": cfg.get("playwright_browsers"),
            "has_figma_token": bool(str(cfg.get("figma_token") or "").strip()),
        }

    @app.get("/api/delivery/tasks")
    async def list_delivery_tasks(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        items = _orch().list_tasks()
        return {"ok": True, "items": items, "count": len(items)}

    @app.get("/api/delivery/tasks/{task_id}")
    async def get_delivery_task(
        task_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        payload = _orch().get_task(task_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="task not found")
        return {"ok": True, **payload}

    @app.post("/api/delivery/tasks")
    async def create_delivery_task(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        spec = TaskSpec(
            project_name=str(payload.get("project_name") or ""),
            target=str(payload.get("target") or "POC"),
            input_files=[str(x) for x in (payload.get("input_files") or []) if x],
            industry_template=str(payload.get("industry_template") or ""),
        )
        result = _orch().start_delivery(spec)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=str(result.get("error") or "start failed"))
        return result

    @app.post("/api/delivery/tasks/{task_id}/resume")
    async def resume_delivery_task(
        task_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        result = _orch().resume_delivery(task_id)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=str(result.get("error") or "resume failed"))
        return result

    @app.put("/api/delivery/config")
    async def put_delivery_settings(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        from agenticx.delivery.config import save_delivery_config

        allowed = ("enabled", "worktree_root", "figma_token", "playwright_browsers", "max_stage_retries")
        patch = {k: payload[k] for k in allowed if k in payload}
        cfg = save_delivery_config(patch)
        return {"ok": True, **{k: cfg.get(k) for k in allowed if k in cfg or k in patch}}

    @app.post("/api/delivery/bootstrap")
    async def bootstrap_delivery_kit(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        from agenticx.delivery.bootstrap import ensure_delivery_bundle

        return ensure_delivery_bundle()
