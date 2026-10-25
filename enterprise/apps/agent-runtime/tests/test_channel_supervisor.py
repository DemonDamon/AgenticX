#!/usr/bin/env python3
"""Channel supervisor with a fake child process.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import importlib
import io
import json
import sys
from types import ModuleType
from typing import Any

import pytest
from sqlalchemy import select

from agenticx.managed.errors import INTERNAL, MAError
from ma_agent_runtime.channels.supervisor import ChannelSupervisor
from ma_agent_runtime.db import build_engines
from ma_agent_runtime.tables import ma_channel_runtime_state

TENANT = "01JTENANT00000000000000001"
OWNER = "01JOWNER000000000000000001"
AGENT = "01JAGENT000000000000000001"
CHANNEL = "01JCHANNEL0000000000000001"
SECRET = "super-secret-value" # gitleaks:allow


class RuntimeSettings:
    channel_reconcile_seconds = 30.0
    channel_inbound_retention_days = 7


class FakeProcess:
    def __init__(self) -> None:
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.returncode: int | None = None
        self.terminated = False

    def terminate(self) -> None:
        self.terminated = True
        if self.returncode is None:
            self.returncode = -15
        if not self.stdout.at_eof():
            self.stdout.feed_eof()
        if not self.stderr.at_eof():
            self.stderr.feed_eof()

    async def wait(self) -> int | None:
        return self.returncode


class FakeClient:
    def __init__(self, channels: list[dict[str, Any]]) -> None:
        self.channels = channels
        self.fail = False

    async def list_runtime_channels(self) -> list[dict[str, Any]]:
        return list(self.channels)

    async def resolve_channel_credential(self, tenant_id: str, channel_id: str) -> dict[str, str]:
        if self.fail:
            raise MAError(INTERNAL, "control plane unavailable")
        return {"app_id": "cli_a1b2c3", "app_secret": SECRET}


class FakeRouter:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def handle_event(self, channel: Any, body: dict[str, Any], api: Any) -> None:
        self.events.append(body)


def payload(revision: int = 1) -> dict[str, Any]:
    return {
        "id": CHANNEL,
        "tenant_id": TENANT,
        "name": "助理",
        "agent_id": AGENT,
        "routing": "follow_latest",
        "pinned_version": None,
        "environment_id": None,
        "app_id": "cli_a1b2c3",
        "owner_user_id": OWNER,
        "config": {"idle_reset_hours": 24, "open_base_url": "https://open.feishu.cn"},
        "revision": revision,
    }


@pytest.fixture
async def engine(sqlite_urls: Any):
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    yield async_engine, sync_engine
    await async_engine.dispose()
    sync_engine.dispose()


def build(pair: Any, client: FakeClient, router: FakeRouter, spawn: Any) -> ChannelSupervisor:
    async_engine, sync_engine = pair
    return ChannelSupervisor(
        engine=async_engine,
        sync_engine=sync_engine,
        client=client,
        router=router,
        settings=RuntimeSettings(),  # type: ignore[arg-type]
        spawn=spawn,
    )


async def read_state(pair: Any) -> dict[str, Any] | None:
    async_engine, _sync = pair
    async with async_engine.connect() as conn:
        row = (
            await conn.execute(
                select(ma_channel_runtime_state).where(ma_channel_runtime_state.c.channel_id == CHANNEL)
            )
        ).mappings().first()
    return dict(row) if row is not None else None


@pytest.mark.asyncio
async def test_starts_child_and_marks_running(engine: Any) -> None:
    procs: list[FakeProcess] = []

    async def spawn(creds: dict[str, str], domain: str) -> FakeProcess:
        proc = FakeProcess()
        procs.append(proc)
        return proc

    client = FakeClient([payload()])
    router = FakeRouter()
    supervisor = build(engine, client, router, spawn)
    await supervisor.reconcile()
    row = await read_state(engine)
    assert row is not None
    assert row["status"] in {"starting", "running"}
    assert int(row["revision"]) == 1
    procs[0].stdout.feed_data(b'{"kind":"event","body":{"n":1}}\n')
    await asyncio.sleep(0.05)
    assert router.events == [{"n": 1}]
    await supervisor.shutdown()


@pytest.mark.asyncio
async def test_restarts_on_revision_change(engine: Any) -> None:
    procs: list[FakeProcess] = []

    async def spawn(creds: dict[str, str], domain: str) -> FakeProcess:
        proc = FakeProcess()
        procs.append(proc)
        return proc

    client = FakeClient([payload(1)])
    supervisor = build(engine, client, FakeRouter(), spawn)
    await supervisor.reconcile()
    client.channels = [payload(2)]
    await supervisor.reconcile()
    assert procs[0].terminated
    assert len(procs) == 2
    row = await read_state(engine)
    assert row is not None
    assert int(row["revision"]) == 2
    await supervisor.shutdown()


@pytest.mark.asyncio
async def test_stops_removed_channels(engine: Any) -> None:
    async def spawn(creds: dict[str, str], domain: str) -> FakeProcess:
        return FakeProcess()

    client = FakeClient([payload()])
    supervisor = build(engine, client, FakeRouter(), spawn)
    await supervisor.reconcile()
    client.channels = []
    await supervisor.reconcile()
    row = await read_state(engine)
    assert row is not None
    assert row["status"] == "stopped"
    await supervisor.shutdown()


@pytest.mark.asyncio
async def test_credential_failure_sets_error(engine: Any) -> None:
    spawned = 0

    async def spawn(creds: dict[str, str], domain: str) -> FakeProcess:
        nonlocal spawned
        spawned += 1
        return FakeProcess()

    client = FakeClient([payload()])
    client.fail = True
    supervisor = build(engine, client, FakeRouter(), spawn)
    await supervisor.reconcile()
    row = await read_state(engine)
    assert row is not None
    assert row["status"] == "error"
    assert row["last_error"] == "credential_unavailable"
    assert spawned == 0
    await supervisor.shutdown()


@pytest.mark.asyncio
async def test_stderr_tail_redacts_secret(engine: Any, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("DEBUG")
    procs: list[FakeProcess] = []

    async def spawn(creds: dict[str, str], domain: str) -> FakeProcess:
        proc = FakeProcess()
        procs.append(proc)
        return proc

    supervisor = build(engine, FakeClient([payload()]), FakeRouter(), spawn)
    await supervisor.reconcile()
    procs[0].stderr.feed_data(f"boom {SECRET}\n".encode())
    procs[0].stderr.feed_eof()
    await asyncio.sleep(0.05)
    procs[0].returncode = 3
    await supervisor.reconcile()
    row = await read_state(engine)
    assert row is not None
    assert SECRET not in (row["last_error"] or "")
    assert SECRET not in caplog.text
    await supervisor.shutdown()


def test_child_reads_config_from_stdin(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class Builder:
        def __init__(self) -> None:
            self.cb: Any = None

        def register_p2_im_message_receive_v1(self, cb: Any) -> Builder:
            self.cb = cb
            return self

        def build(self) -> Builder:
            return self

    class Handler:
        @staticmethod
        def builder(_verification: str, _encrypt: str) -> Builder:
            return Builder()

    class JsonTool:
        @staticmethod
        def marshal(data: object) -> str:
            return json.dumps({"ok": True})

    class Client:
        def __init__(self, app_id: str, app_secret: str, event_handler: Any = None, domain: str | None = None, log_level: Any = None) -> None:
            captured["app_id"] = app_id
            captured["domain"] = domain
            captured["handler"] = event_handler

        def start(self) -> None:
            captured["handler"].cb({"n": 1})

    class Level:
        INFO = 1

    class Ws:
        pass

    Ws.Client = Client

    fake = ModuleType("lark_oapi")
    fake.EventDispatcherHandler = Handler  # type: ignore[attr-defined]
    fake.JSON = JsonTool  # type: ignore[attr-defined]
    fake.ws = Ws  # type: ignore[attr-defined]
    fake.LogLevel = Level  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "lark_oapi", fake)
    sys.modules.pop("ma_agent_runtime.channels.feishu_child", None)
    stdout = io.StringIO()
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(json.dumps({"app_id": "cli_abc123", "app_secret": "sec", "domain": "https://open.feishu.cn"}) + "\n"),
    )
    monkeypatch.setattr(sys, "stdout", stdout)
    child = importlib.import_module("ma_agent_runtime.channels.feishu_child")
    assert child.main() == 0
    assert captured["app_id"] == "cli_abc123"
    assert captured["domain"] == "https://open.feishu.cn"
    lines = [line for line in stdout.getvalue().splitlines() if line.strip()]
    assert len(lines) == 1
    assert json.loads(lines[0])["kind"] == "event"
    assert "sec" not in lines[0]
