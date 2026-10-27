#!/usr/bin/env python3
"""One long-connection child per enabled Feishu channel, on a single replica.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine

from agenticx.managed.errors import MAError

from ma_agent_runtime.channels.feishu_api import FeishuOpenApi
from ma_agent_runtime.channels.router import ChannelConfig, utc_now
from ma_agent_runtime.config import SECRET_ENV_RE, Settings
from ma_agent_runtime.tables import ma_channel_inbound, ma_channel_runtime_state

logger = logging.getLogger(__name__)


@dataclass
class ChildHandle:
    process: Any
    revision: int
    reader_task: asyncio.Task[None] | None = None
    stderr_task: asyncio.Task[None] | None = None
    promote_task: asyncio.Task[None] | None = None
    api: FeishuOpenApi | None = None
    started_monotonic: float = 0.0
    secret: str = ""
    stderr_tail: list[str] = field(default_factory=list)
    exit_recorded: bool = False
    channel: ChannelConfig | None = None


def channel_from_payload(raw: dict[str, Any]) -> ChannelConfig:
    config = raw.get("config") if isinstance(raw.get("config"), dict) else {}
    idle = config.get("idle_reset_hours", 24)
    try:
        idle_hours = float(idle)
    except (TypeError, ValueError):
        idle_hours = 24.0
    base = config.get("open_base_url") or "https://open.feishu.cn"
    pinned = raw.get("pinned_version")
    try:
        pinned_version = int(pinned) if pinned is not None else None
    except (TypeError, ValueError):
        pinned_version = None
    return ChannelConfig(
        id=str(raw["id"]),
        tenant_id=str(raw["tenant_id"]),
        name=str(raw.get("name") or ""),
        agent_id=str(raw["agent_id"]),
        routing=str(raw.get("routing") or "follow_latest"),
        pinned_version=pinned_version,
        environment_id=raw.get("environment_id") if isinstance(raw.get("environment_id"), str) else None,
        app_id=str(raw["app_id"]),
        owner_user_id=str(raw["owner_user_id"]),
        idle_reset_hours=idle_hours,
        open_base_url=str(base),
        revision=int(raw["revision"]),
    )


def redact(value: str, secret: str) -> str:
    if secret:
        return value.replace(secret, "")
    return value


class ChannelSupervisor:
    """Reconcile enabled channels against local long-connection children."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        sync_engine: Engine,
        client: Any,
        router: Any,
        settings: Settings,
        spawn: Callable[..., Awaitable[Any]] | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._engine = engine
        self._sync_engine = sync_engine
        self._client = client
        self._router = router
        self._settings = settings
        self._spawn = spawn or self._default_spawn
        self._clock = clock
        self._children: dict[str, ChildHandle] = {}
        self._stopped = False
        self._locked = False
        self._lock_conn: Any = None
        self._delays: dict[str, float] = {}
        self._ready_at: dict[str, float] = {}
        self._last_purge = time.monotonic()

    async def run_forever(self) -> None:
        while not self._stopped:
            if not self._locked:
                locked = await asyncio.to_thread(self._try_lock)
                if not locked:
                    await asyncio.sleep(30)
                    continue
                self._locked = True
            try:
                await self.reconcile()
            except Exception:
                logger.warning("channel reconcile failed")
            await asyncio.sleep(self._settings.channel_reconcile_seconds)

    async def reconcile(self) -> None:
        raw_channels = await self._client.list_runtime_channels()
        channels = [channel_from_payload(item) for item in raw_channels if isinstance(item, dict)]
        seen: set[str] = set()
        for channel in channels:
            seen.add(channel.id)
            current = self._children.get(channel.id)
            if current is not None and current.revision != channel.revision:
                self._delays.pop(channel.id, None)
                self._ready_at.pop(channel.id, None)
                await self._terminate(current)
                self._children.pop(channel.id, None)
                current = None
            if current is None:
                if self._backoff_waiting(channel.id):
                    continue
                await self._start(channel)
                continue
            if getattr(current.process, "returncode", None) is not None:
                if not current.exit_recorded:
                    await self._record_exit(current)
                    current.exit_recorded = True
                    self._schedule_backoff(channel.id)
                if self._backoff_waiting(channel.id):
                    continue
                await self._terminate(current)
                self._children.pop(channel.id, None)
                await self._start(channel)
        for channel_id, handle in list(self._children.items()):
            if channel_id in seen:
                continue
            await self._terminate(handle)
            self._children.pop(channel_id, None)
            if handle.channel is not None:
                await self._write_state(handle.channel, "stopped", last_error=None, started=False)
        await self._maybe_purge()

    async def shutdown(self) -> None:
        self._stopped = True
        for handle in list(self._children.values()):
            await self._terminate(handle)
        self._children.clear()
        await asyncio.to_thread(self._unlock)

    async def _start(self, channel: ChannelConfig) -> None:
        await self._write_state(channel, "starting", last_error=None, started=True)
        try:
            creds = await self._client.resolve_channel_credential(channel.tenant_id, channel.id)
        except MAError:
            logger.warning("channel credential failed channel=%s", channel.id)
            await self._write_state(channel, "error", last_error="credential_unavailable", started=False)
            self._schedule_backoff(channel.id)
            return
        except Exception:
            logger.warning("channel start failed channel=%s", channel.id)
            await self._write_state(channel, "error", last_error="start_failed", started=False)
            self._schedule_backoff(channel.id)
            return
        secret = str(creds.get("app_secret") or "")
        try:
            spawned = await self._spawn(creds, channel.open_base_url)
        except Exception:
            logger.warning("channel spawn failed channel=%s", channel.id)
            await self._write_state(channel, "error", last_error="start_failed", started=False)
            self._schedule_backoff(channel.id)
            return
        process = getattr(spawned, "process", spawned)
        api = FeishuOpenApi(
            app_id=str(creds.get("app_id") or channel.app_id),
            app_secret=secret,
            base_url=channel.open_base_url,
        )
        handle = ChildHandle(
            process=process,
            revision=channel.revision,
            api=api,
            started_monotonic=time.monotonic(),
            secret=secret,
            channel=channel,
        )
        self._children[channel.id] = handle
        self._delays.pop(channel.id, None)
        self._ready_at.pop(channel.id, None)
        handle.reader_task = asyncio.create_task(self._read_stdout(channel, handle))
        handle.stderr_task = asyncio.create_task(self._read_stderr(handle))
        handle.promote_task = asyncio.create_task(self._promote(channel))

    async def _default_spawn(self, creds: dict[str, str], domain: str) -> Any:
        env = {key: value for key, value in os.environ.items() if SECRET_ENV_RE.fullmatch(key) is None}
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "ma_agent_runtime.channels.feishu_child",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        payload = json.dumps(
            {"app_id": creds["app_id"], "app_secret": creds["app_secret"], "domain": domain},
            ensure_ascii=False,
        )
        if process.stdin is None:
            raise RuntimeError("channel child stdin is closed")
        process.stdin.write((payload + "\n").encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()
        return process

    async def _read_stdout(self, channel: ChannelConfig, handle: ChildHandle) -> None:
        stream = getattr(handle.process, "stdout", None)
        if stream is None:
            return
        while True:
            line = await stream.readline()
            if not line:
                return
            text_line = line.decode("utf-8", errors="replace").strip()
            if not text_line:
                continue
            try:
                payload = json.loads(text_line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict) or payload.get("kind") != "event":
                continue
            body = payload.get("body")
            if not isinstance(body, dict) or handle.api is None:
                continue
            await self._touch_event(channel)
            asyncio.create_task(self._router.handle_event(channel, body, handle.api))

    async def _read_stderr(self, handle: ChildHandle) -> None:
        stream = getattr(handle.process, "stderr", None)
        if stream is None:
            return
        while True:
            line = await stream.readline()
            if not line:
                return
            handle.stderr_tail.append(line.decode("utf-8", errors="replace").rstrip("\n"))
            if len(handle.stderr_tail) > 20:
                handle.stderr_tail = handle.stderr_tail[-20:]

    async def _promote(self, channel: ChannelConfig) -> None:
        await asyncio.sleep(5)
        handle = self._children.get(channel.id)
        if handle is None or handle.revision != channel.revision:
            return
        if getattr(handle.process, "returncode", None) is not None:
            return
        await self._write_state(channel, "running", last_error=None, started=False)

    async def _record_exit(self, handle: ChildHandle) -> None:
        if handle.channel is None:
            return
        tail = redact("\n".join(handle.stderr_tail), handle.secret)[:400]
        code = getattr(handle.process, "returncode", None)
        await self._write_state(handle.channel, "error", last_error=f"exited {code}: {tail}"[:500], started=False)

    async def _terminate(self, handle: ChildHandle) -> None:
        process = handle.process
        if getattr(process, "returncode", None) is None:
            terminate = getattr(process, "terminate", None)
            if callable(terminate):
                terminate()
            wait = getattr(process, "wait", None)
            if callable(wait):
                try:
                    await asyncio.wait_for(wait(), timeout=1)
                except Exception:
                    kill = getattr(process, "kill", None)
                    if callable(kill):
                        kill()
        for task in (handle.reader_task, handle.stderr_task, handle.promote_task):
            if task is not None and not task.done():
                task.cancel()
        if handle.api is not None:
            await handle.api.aclose()

    async def _write_state(
        self,
        channel: ChannelConfig,
        status: str,
        *,
        last_error: str | None,
        started: bool,
    ) -> None:
        now = self._clock()
        values: dict[str, Any] = {
            "channel_id": channel.id,
            "tenant_id": channel.tenant_id,
            "revision": channel.revision,
            "status": status,
            "last_error": last_error,
            "updated_at": now,
        }
        if started:
            values["started_at"] = now
        async with self._engine.begin() as conn:
            insert = pg_insert if conn.dialect.name == "postgresql" else sqlite_insert
            stmt = insert(ma_channel_runtime_state).values(**values)
            assigned = {
                "tenant_id": stmt.excluded.tenant_id,
                "revision": stmt.excluded.revision,
                "status": stmt.excluded.status,
                "last_error": stmt.excluded.last_error,
                "updated_at": stmt.excluded.updated_at,
            }
            if started:
                assigned["started_at"] = stmt.excluded.started_at
            await conn.execute(stmt.on_conflict_do_update(index_elements=["channel_id"], set_=assigned))

    async def _touch_event(self, channel: ChannelConfig) -> None:
        now = self._clock()
        async with self._engine.begin() as conn:
            await conn.execute(
                ma_channel_runtime_state.update()
                .where(ma_channel_runtime_state.c.channel_id == channel.id)
                .values(last_event_at=now, updated_at=now)
            )

    async def _maybe_purge(self) -> None:
        now = time.monotonic()
        if now - self._last_purge < 3600:
            return
        self._last_purge = now
        cutoff = self._clock() - timedelta(days=self._settings.channel_inbound_retention_days)
        async with self._engine.begin() as conn:
            await conn.execute(delete(ma_channel_inbound).where(ma_channel_inbound.c.received_at < cutoff))

    def _schedule_backoff(self, channel_id: str) -> None:
        previous = self._delays.get(channel_id, 0)
        delay = 5.0 if previous <= 0 else min(300.0, previous * 2)
        self._delays[channel_id] = delay
        self._ready_at[channel_id] = time.monotonic() + delay

    def _backoff_waiting(self, channel_id: str) -> bool:
        ready = self._ready_at.get(channel_id)
        return ready is not None and time.monotonic() < ready

    def _try_lock(self) -> bool:
        if self._sync_engine.dialect.name != "postgresql":
            return True
        if self._lock_conn is None:
            self._lock_conn = self._sync_engine.connect()
        locked = self._lock_conn.execute(text("SELECT pg_try_advisory_lock(hashtext('agx_ma_channels'))")).scalar()
        return bool(locked)

    def _unlock(self) -> None:
        if self._lock_conn is None:
            return
        if self._sync_engine.dialect.name == "postgresql":
            self._lock_conn.execute(text("SELECT pg_advisory_unlock(hashtext('agx_ma_channels'))"))
        self._lock_conn.close()
        self._lock_conn = None
