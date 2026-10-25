#!/usr/bin/env python3
"""FastAPI application factory for the Managed Agents host.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from agenticx.managed.builder import ManagedAgentBuilder
from agenticx.managed.credential_extension import install_credential_broker
from agenticx.managed.credentials import LocalCredentialProvider
from agenticx.managed.errors import INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.events import EventBroadcaster, EventLog, SqliteEventStore
from agenticx.managed.events.store import EventStore
from agenticx.managed.host.auth import StaticTokenAuthenticator, TokenAuthenticator
from agenticx.managed.host.config import HostConfig
from agenticx.managed.host.ingest import stop_expired_work
from agenticx.managed.host.registry import AgentRegistry, StaticAgentRegistry
from agenticx.managed.host.remote_executor import RemoteWorkerExecutor
from agenticx.managed.host.routes import build_session_router
from agenticx.managed.host.service import SessionService
from agenticx.managed.host.work_queue import SqliteWorkQueue
from agenticx.managed.host.worker_routes import build_worker_router
from agenticx.managed.llm import LLMFactory, LocalConfigLLMFactory
from agenticx.managed.protocol import WORK_HEARTBEAT_INTERVAL_SECONDS

logger = logging.getLogger(__name__)


@dataclass
class MAHostState:
    """Process-wide host objects. MA-A05 stores its work queue on ``extras``."""

    config: HostConfig
    store: EventStore
    event_log: EventLog
    registry: AgentRegistry
    service: SessionService
    authenticator: TokenAuthenticator
    startup_hooks: list[Callable[[], Awaitable[None]]] = field(default_factory=list)
    shutdown_hooks: list[Callable[[], Awaitable[None]]] = field(default_factory=list)
    extras: dict[str, Any] = field(default_factory=dict)

    async def startup(self) -> None:
        """Recover unsettled sessions, then run startup hooks in order."""
        await self.service.startup()
        for hook in self.startup_hooks:
            await hook()

    async def shutdown(self) -> None:
        """Run shutdown hooks in reverse, then close executors and the store."""
        for hook in reversed(self.shutdown_hooks):
            await hook()
        await self.service.shutdown()


def register_exception_handlers(app: FastAPI) -> None:
    """Map managed errors onto the wire shape ``{"error": {...}}``."""

    @app.exception_handler(MAError)
    async def handle_ma_error(_request: Request, exc: MAError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=exc.to_dict())

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        err = MAError(
            INVALID_REQUEST,
            "invalid request",
            details={"errors": jsonable_encoder(exc.errors())},
        )
        return JSONResponse(status_code=err.http_status, content=err.to_dict())

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("managed host request failed")
        return JSONResponse(
            status_code=500,
            content=MAError(INTERNAL, "internal error").to_dict(),
        )


def create_ma_app(
    config: HostConfig,
    *,
    llm_factory: LLMFactory | None = None,
    store: EventStore | None = None,
    registry: AgentRegistry | None = None,
    authenticator: TokenAuthenticator | None = None,
) -> FastAPI:
    """Build the host app. State is created synchronously so tests can skip lifespan."""
    resolved_store = store if store is not None else SqliteEventStore(config.db_path)
    event_log = EventLog(resolved_store, EventBroadcaster())
    resolved_registry = registry if registry is not None else StaticAgentRegistry(config)
    builder = ManagedAgentBuilder(
        llm_factory=llm_factory or LocalConfigLLMFactory(),
        workdir_root=config.workdir_root,
    )
    service = SessionService(
        config=config,
        event_log=event_log,
        registry=resolved_registry,
        builder=builder,
    )
    state = MAHostState(
        config,
        resolved_store,
        event_log,
        resolved_registry,
        service,
        authenticator or StaticTokenAuthenticator(config.tokens),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> Any:
        await state.startup()
        try:
            yield
        finally:
            await state.shutdown()

    app = FastAPI(title="AgenticX Managed Agents Host", lifespan=lifespan)
    app.state.ma = state
    register_exception_handlers(app)
    app.include_router(build_session_router(state))
    install_credential_broker(
        state,
        LocalCredentialProvider(config.vaults),
        egress_enforce=True,
    )
    if isinstance(resolved_store, SqliteEventStore):
        work_queue = SqliteWorkQueue(resolved_store)
        state.extras["work_queue"] = work_queue
        service.register_executor_factory(
            "desktop_worker",
            lambda actor: RemoteWorkerExecutor(actor, work_queue),
        )
        app.include_router(build_worker_router(state, work_queue))

        async def _stop_stale_leases_on_startup() -> None:
            for item in work_queue.leased_items():
                consumed = await resolved_store.last_seq(item.tenant_id, item.session_id)
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
    return app


__all__ = [
    "MAHostState",
    "create_ma_app",
    "register_exception_handlers",
]
