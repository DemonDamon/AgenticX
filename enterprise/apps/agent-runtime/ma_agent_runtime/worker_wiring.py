#!/usr/bin/env python3
"""Wire the desktop-worker plane onto a non-SQLite event store.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI

from agenticx.managed.host.ingest import stop_expired_work
from agenticx.managed.host.remote_executor import RemoteWorkerExecutor
from agenticx.managed.host.worker_routes import build_worker_router
from agenticx.managed.protocol import WORK_HEARTBEAT_INTERVAL_SECONDS

from ma_agent_runtime.desktop_access import EligibilityResolver, build_work_environments_router
from ma_agent_runtime.pg_work_queue import PgWorkQueue

logger = logging.getLogger(__name__)


def wire_worker_plane(
    app: FastAPI,
    work_queue: PgWorkQueue,
    *,
    resolver: EligibilityResolver,
) -> None:
    """Register the desktop executor, worker routes, and the lease sweeper.

    ``create_ma_app`` only does this for ``SqliteEventStore``. A PostgreSQL
    store has to call this itself.
    """
    state = app.state.ma
    service = state.service
    state.extras["work_queue"] = work_queue
    service.register_executor_factory(
        "desktop_worker",
        lambda actor: RemoteWorkerExecutor(actor, work_queue),
    )
    app.include_router(build_work_environments_router(lambda: app.state.ma, resolver))
    app.include_router(build_worker_router(state, work_queue))

    async def _stop_stale_leases_on_startup() -> None:
        for item in work_queue.leased_items():
            consumed = await state.store.last_seq(item.tenant_id, item.session_id)
            work_queue.finish(
                item.tenant_id,
                item.id,
                status="stopped",
                error="host restarted",
                consumed_through_seq=consumed,
            )

    async def _start_sweeper() -> None:
        async def _loop() -> None:
            while True:
                await asyncio.sleep(WORK_HEARTBEAT_INTERVAL_SECONDS)
                try:
                    await stop_expired_work(service, work_queue)
                except Exception:
                    logger.exception("work lease sweeper failed")

        state.extras["work_sweeper"] = asyncio.create_task(_loop())

    async def _stop_sweeper() -> None:
        task = state.extras.pop("work_sweeper", None)
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    state.startup_hooks.extend([_stop_stale_leases_on_startup, _start_sweeper])
    state.shutdown_hooks.append(_stop_sweeper)


__all__ = [
    "wire_worker_plane",
]
