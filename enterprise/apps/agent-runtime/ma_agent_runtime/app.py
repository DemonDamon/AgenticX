#!/usr/bin/env python3
"""FastAPI factory for the enterprise managed-agent runtime.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from agenticx.managed.budget import BudgetGuardedLLMFactory
from agenticx.managed.credential_extension import install_credential_broker
from agenticx.managed.credentials import EnterpriseVaultProvider
from agenticx.managed.memory import EnterpriseMemoryStoreClient
from agenticx.managed.memory_mount import install_memory_mounts
from agenticx.managed.gateway_llm import GatewayLLMFactory
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import HostConfig
from agenticx.managed.redaction import install_log_redaction

from ma_agent_runtime.channels.router import ChannelRouter
from ma_agent_runtime.evals import wire_evals
from ma_agent_runtime.memory_dreams import wire_dreams
from ma_agent_runtime.channels.supervisor import ChannelSupervisor
from ma_agent_runtime.config import (
    Settings,
    apply_runtime_env_defaults,
    scrub_secret_env,
)
from ma_agent_runtime.control_plane import (
    AdminConsoleAgentRegistry,
    AdminConsoleClient,
    OnBehalfOfMiddleware,
    PatIntrospectionAuthenticator,
)
from ma_agent_runtime.db import build_engines, split_database_url
from ma_agent_runtime.desktop_access import DesktopAccessMiddleware, EligibilityResolver
from ma_agent_runtime.isolation import (
    ensure_isolated_home,
    probe_command_sandbox,
    write_runtime_config,
)
from ma_agent_runtime.pg_work_queue import PgWorkQueue
from ma_agent_runtime.quota import AgentQuotaEnforcer, wrap_executors_with_quota
from ma_agent_runtime.scheduler import ScheduleTicker
from ma_agent_runtime.session_hooks import HookedPgEventStore
from ma_agent_runtime.webhook_events_routes import build_internal_router
from ma_agent_runtime.webhooks import (
    SESSION_EVENT_MAP,
    CredentialExpiryScanner,
    WebhookConfigCache,
    WebhookDeliverer,
    WebhookOutbox,
)
from ma_agent_runtime.worker_wiring import wire_worker_plane

logger = logging.getLogger(__name__)


def build_app(
    settings: Settings,
    *,
    admin_transport: httpx.AsyncBaseTransport | None = None,
    scrub_env: bool = True,
    search_path: str | None = None,
    quota_http: httpx.Client | None = None,
) -> FastAPI:
    """Assemble the managed host with enterprise storage, auth, and the gateway."""
    data_dir = ensure_isolated_home(settings.home)
    write_runtime_config(settings.home)
    probe_command_sandbox(settings.home, mode=settings.command_sandbox)
    apply_runtime_env_defaults()
    if scrub_env:
        removed = scrub_secret_env()
        logger.info("scrubbed %d secret env vars", len(removed))
    urls = split_database_url(settings.database_url, search_path=search_path)
    if urls.dialect == "sqlite" and not settings.allow_sqlite:
        raise RuntimeError(
            "DATABASE_URL: agent-runtime supports PostgreSQL only in this version"
        )
    async_engine, sync_engine = build_engines(urls, pool_size=settings.db_pool_size)
    client = AdminConsoleClient(
        settings.admin_url,
        settings.internal_token,
        transport=admin_transport,
    )
    registry = AdminConsoleAgentRegistry(
        client,
        cache_seconds=settings.registry_cache_seconds,
        implicit_local_env=settings.implicit_local_env,
    )
    authenticator = PatIntrospectionAuthenticator(
        client,
        cache_seconds=settings.pat_cache_seconds,
        desktop_pat_enabled=settings.desktop_pat_enabled,
    )
    llm_factory: Any = GatewayLLMFactory(
        base_url=settings.gateway_url,
        token=settings.gateway_token,
        timeout_seconds=settings.llm_timeout_seconds,
    )
    enforcer: AgentQuotaEnforcer | None = None
    if settings.agent_quota_enabled:
        enforcer = AgentQuotaEnforcer(
            sync_engine=sync_engine,
            admin_url=settings.admin_url,
            internal_token=settings.internal_token,
            settings=settings,
            http=quota_http,
        )
        llm_factory = BudgetGuardedLLMFactory(llm_factory, enforcer.guard, enforcer.note_model_result)
    config = HostConfig(
        data_dir=data_dir,
        tenant_id="enterprise",
        tokens={},
        agents={},
        environments={},
        dev=False,
        interrupt_grace_seconds=settings.interrupt_grace_seconds,
        tasks_enabled=settings.tasks_enabled,
        threads_enabled=settings.threads_enabled,
        task_foreground_seconds=settings.task_foreground_seconds,
        task_max_runtime_seconds=settings.task_max_runtime_seconds,
        max_running_tasks=settings.max_running_tasks,
    )
    store = HookedPgEventStore(async_engine)
    app = create_ma_app(
        config,
        llm_factory=llm_factory,
        store=store,
        registry=registry,
        authenticator=authenticator,
    )
    install_log_redaction()
    if not settings.egress_enforce:
        logger.warning("MA_RUNTIME_EGRESS_ENFORCE=0: egress allow list is not enforced")
    provider = (
        EnterpriseVaultProvider(
            settings.admin_url,
            settings.internal_token,
            transport=admin_transport,
        )
        if settings.credentials_enabled
        else None
    )
    install_credential_broker(
        app.state.ma,
        provider,
        egress_enforce=settings.egress_enforce,
    )
    if settings.memory_enabled:
        install_memory_mounts(
            app.state.ma,
            EnterpriseMemoryStoreClient(
                settings.admin_url,
                settings.internal_token,
                transport=admin_transport,
            ),
        )
    app.add_middleware(OnBehalfOfMiddleware)

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/readyz")
    async def readyz() -> JSONResponse:
        try:
            async with async_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            logger.warning("readyz check failed")
            return JSONResponse({"ok": False}, status_code=503)
        return JSONResponse({"ok": True})

    async def _close_extras() -> None:
        await client.aclose()
        sync_engine.dispose()

    # Disposing the sync engine is registered before the worker sweeper hook so
    # shutdown (which runs hooks in reverse) cancels the sweeper first.
    app.state.ma.shutdown_hooks.append(_close_extras)
    resolver = EligibilityResolver(
        client, cache_seconds=settings.eligibility_cache_seconds
    )
    work_queue = PgWorkQueue(sync_engine) if settings.desktop_worker_enabled else None
    if work_queue is not None:
        wire_worker_plane(app, work_queue, resolver=resolver)
    if settings.desktop_worker_enabled or settings.desktop_pat_enabled:
        app.add_middleware(
            DesktopAccessMiddleware,
            state_getter=lambda: app.state.ma,
            resolver=resolver,
            work_queue=work_queue,
            enforce_worker_rules=settings.desktop_worker_enabled,
            enforce_desktop_sessions=settings.desktop_pat_enabled,
        )

    def _add_background(name: str, coro_fn: Callable[[], Awaitable[None]]) -> None:
        async def start() -> None:
            app.state.ma.extras[name] = asyncio.create_task(coro_fn(), name=name)

        async def stop() -> None:
            task = app.state.ma.extras.pop(name, None)
            if isinstance(task, asyncio.Task):
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        app.state.ma.startup_hooks.append(start)
        app.state.ma.shutdown_hooks.append(stop)

    if settings.scheduler_enabled or settings.webhooks_enabled:
        async def _drain_listeners() -> None:
            await store.drain()

        # Registered before the cancel hooks so shutdown (reverse order) drains last.
        app.state.ma.shutdown_hooks.append(_drain_listeners)

    outbox: WebhookOutbox | None = None
    cache: WebhookConfigCache | None = None
    if settings.webhooks_enabled:
        cache = WebhookConfigCache(client, ttl=settings.webhook_config_cache_seconds)
        outbox = WebhookOutbox(engine=async_engine, cache=cache, store=store)

    if settings.scheduler_enabled:
        ticker = ScheduleTicker(
            engine=async_engine,
            client=client,
            service=app.state.ma.service,
            settings=settings,
            on_run_event=None if outbox is None else outbox.enqueue_schedule_run_event,
        )
        store.add_terminal_listener(ticker.on_terminal)
        _add_background("schedule_ticker", ticker.run_forever)
    if outbox is not None and cache is not None:
        store.add_terminal_listener(outbox.on_terminal)
        store.add_event_listener(outbox.on_session_event, frozenset(SESSION_EVENT_MAP))
        deliverer = WebhookDeliverer(
            engine=async_engine,
            cache=cache,
            settings=settings,
            client=client,
        )
        app.include_router(build_internal_router(settings, outbox, async_engine))
        _add_background("webhook_deliverer", deliverer.run_forever)
        _add_background(
            "credential_expiry_scanner",
            CredentialExpiryScanner(client=client, outbox=outbox).run_forever,
        )
    if settings.channels_enabled:
        router = ChannelRouter(
            engine=async_engine,
            service=app.state.ma.service,
            registry=registry,
            settings=settings,
            poll_seconds=settings.channel_poll_seconds,
        )
        supervisor = ChannelSupervisor(
            engine=async_engine,
            sync_engine=sync_engine,
            client=client,
            router=router,
            settings=settings,
        )
        app.state.ma.extras["channel_supervisor"] = supervisor

        async def _start_channels() -> None:
            app.state.ma.extras["channel_supervisor_task"] = asyncio.create_task(
                supervisor.run_forever(),
                name="channel_supervisor",
            )

        async def _stop_channels() -> None:
            await supervisor.shutdown()
            task = app.state.ma.extras.pop("channel_supervisor_task", None)
            if isinstance(task, asyncio.Task):
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        app.state.ma.startup_hooks.append(_start_channels)
        app.state.ma.shutdown_hooks.append(_stop_channels)
    if enforcer is not None:
        wrap_executors_with_quota(app.state.ma.service, enforcer)

        async def _close_quota() -> None:
            enforcer.close()

        app.state.ma.shutdown_hooks.append(_close_quota)
    # MA-E12 eval executor. MA-A10 should add its own block beside this one.
    if settings.evals_enabled:
        wire_evals(
            app,
            sync_engine=sync_engine,
            llm_factory=llm_factory,
            settings=settings,
        )
    if settings.dreams_enabled:
        wire_dreams(app, sync_engine=sync_engine, llm_factory=llm_factory, settings=settings)
    return app


def create_app() -> FastAPI:
    """uvicorn factory: ``build_app(Settings.from_env())``."""
    logging.basicConfig(level=os.environ.get("MA_RUNTIME_LOG_LEVEL", "INFO"))
    return build_app(Settings.from_env())


__all__ = [
    "build_app",
    "create_app",
]
