#!/usr/bin/env python3
"""Studio HTTP routes for long-running orchestration.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List

from agenticx.cli.config_manager import ConfigManager
from agenticx.longrun.bootstrap import resolve_longrun_workspace_root, resolve_worker_session_id
from agenticx.longrun.orchestrator import LongRunOrchestrator, LongRunOrchestratorConfig
from agenticx.longrun.sources import ComboTaskSource, CronSource, ManualSource
from agenticx.longrun.sources.linear_source import LinearTaskSource
from agenticx.longrun.task_workspace import TaskWorkspaceConfig

logger = logging.getLogger(__name__)


class _MergedLongRunSources:
    """Chain manual+cron with optional Linear."""

    def __init__(self, bases: List[Any]) -> None:
        self._bases = bases

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for src in self._bases:
            batch = await src.fetch_pending_tasks()
            for row in batch:
                tid = str(row.get("id", "") or "").strip()
                if not tid or tid in seen:
                    continue
                seen.add(tid)
                merged.append(row)
        return merged

    async def mark_task_done(self, task_id: str) -> None:
        for src in self._bases:
            try:
                await src.mark_task_done(task_id)
            except Exception:
                logger.debug("mark_task_done partial failure", exc_info=True)


def _longrun_llm_factory() -> Any:
    from agenticx.llms.provider_resolver import ProviderResolver

    cfg = ConfigManager.load()
    pc = cfg.get_provider(cfg.default_provider)
    return ProviderResolver.resolve(provider_name=pc.name, model=pc.model)


async def attach_longrun(app: Any) -> asyncio.Task[None]:
    """Register authenticated routes and start poll loop."""
    from fastapi import Body, FastAPI, Header, HTTPException

    if not isinstance(app, FastAPI):
        raise TypeError("FastAPI app required")

    manager = app.state.session_manager
    desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "").strip()

    def _check_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            return
        if x_agx_desktop_token != desktop_token:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    cfg = ConfigManager.load().longrun
    manual = ManualSource()
    cron = CronSource()
    combo = ComboTaskSource(manual, cron)
    bases: List[Any] = [combo]
    linear_key = str(cfg.linear_api_key or "").strip() or __import__("os").environ.get(
        "LINEAR_API_KEY", ""
    ).strip()
    if linear_key:
        bases.append(LinearTaskSource(api_key=linear_key, team_ids=cfg.linear_team_ids))
    merged_source = _MergedLongRunSources(bases)

    ws_root = resolve_longrun_workspace_root()
    worker_sid = resolve_worker_session_id()

    orch_conf = LongRunOrchestratorConfig(
        poll_interval_sec=float(cfg.poll_interval_sec),
        stall_threshold_sec=float(cfg.stall_threshold_sec),
        workspace_config=TaskWorkspaceConfig(root=ws_root),
    )

    async def _submit(entry: Any) -> Dict[str, Any]:
        managed = manager.get(worker_sid)
        if managed is None:
            managed = manager.create(session_id=worker_sid)
        tm = managed.get_or_create_team(llm_factory=_longrun_llm_factory)
        return await tm.submit_for_longrun(entry)

    orch = LongRunOrchestrator(
        config=orch_conf,
        task_source=merged_source,
        submit_fn=_submit,
    )

    app.state.longrun_manual_source = manual
    app.state.longrun_orchestrator = orch

    @app.get("/api/longrun/state")
    async def longrun_state(x_agx_desktop_token: str | None = Header(default=None)) -> dict:
        _check_token(x_agx_desktop_token)
        snap = orch.snapshot()
        snap["ok"] = True
        return snap

    @app.post("/api/longrun/tasks")
    async def longrun_enqueue_task(
        body: Dict[str, Any] = Body(default_factory=dict),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        tid = str(body.get("id", "") or "").strip()
        if not tid:
            raise HTTPException(status_code=400, detail="id is required")
        task_text = str(body.get("task") or body.get("prompt") or "").strip()
        if not task_text:
            raise HTTPException(status_code=400, detail="task or prompt is required")
        row = {**body, "id": tid, "task": task_text}
        await manual.enqueue(row)
        return {"ok": True, "task_id": tid}

    @app.post("/api/longrun/webhook/enqueue")
    async def longrun_webhook_enqueue(
        body: Dict[str, Any] = Body(default_factory=dict),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        tasks = body.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            raise HTTPException(status_code=400, detail="tasks array required")
        count = 0
        for raw in tasks:
            if not isinstance(raw, dict):
                continue
            tid = str(raw.get("id", "") or "").strip()
            task_text = str(raw.get("task") or raw.get("prompt") or "").strip()
            if not tid or not task_text:
                continue
            await manual.enqueue({**raw, "id": tid, "task": task_text})
            count += 1
        return {"ok": True, "enqueued": count}

    return await orch.start_background()
