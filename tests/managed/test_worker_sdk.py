#!/usr/bin/env python3
"""Worker SDK client, broker, and runner tests.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
import pytest
from typer.testing import CliRunner

from agenticx.cli.main import app
from agenticx.managed.events.adapter import RuntimeEventAdapter
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import (
    SessionRecord,
    Usage,
    UserCustomToolResult,
    UserToolConfirmation,
    WorkItemRecord,
)
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, tool_call
from agenticx.managed.worker.broker import RemoteActionBroker
from agenticx.managed.worker.client import (
    MAWorkerClient,
    MAWorkerError,
    WorkAssignment,
    WorkLeaseLostError,
    WorkerAuthError,
)
from agenticx.managed.worker.runner import WorkItemRunner

_TOKEN = "super-secret-token" # gitleaks:allow
_DEVICE = "device-01"


class _RecordingSink:
    def __init__(self) -> None:
        self.batches: list[tuple[list[dict[str, Any]], bool]] = []

    async def emit(self, events: list[dict[str, Any]], *, flush: bool = False) -> None:
        self.batches.append((list(events), flush))


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/ack"):
        body = {"error": {"code": "unauthorized", "message": f"no {_TOKEN}"}}
        return httpx.Response(401, json=body)
    if path.endswith("/heartbeat"):
        body = {"error": {"code": "work_lease_lost", "message": f"lost {_TOKEN}"}}
        return httpx.Response(409, json=body)
    if path.endswith("/fail"):
        body = {"error": {"code": "internal_error", "message": f"boom {_TOKEN}"}}
        return httpx.Response(500, json=body)
    return httpx.Response(404, json={"error": {"code": "missing", "message": "no"}})


async def test_client_error_mapping() -> None:
    transport = httpx.MockTransport(_handler)
    async with httpx.AsyncClient(transport=transport, trust_env=False) as http:
        client = MAWorkerClient("http://ma.test", _TOKEN, http=http)
        with pytest.raises(WorkerAuthError) as auth_error:
            await client.ack("work-1", _DEVICE)
        assert auth_error.value.status == 401
        assert _TOKEN not in str(auth_error.value)
        with pytest.raises(WorkLeaseLostError) as lost:
            await client.heartbeat("work-1", _DEVICE)
        assert lost.value.status == 409
        assert lost.value.code == "work_lease_lost"
        assert _TOKEN not in str(lost.value)
        with pytest.raises(MAWorkerError) as generic:
            await client.fail("work-1", _DEVICE, "x")
        assert type(generic.value) is MAWorkerError
        assert generic.value.status == 500
        assert _TOKEN not in str(generic.value)


async def test_remote_broker_request_and_deliver() -> None:
    sink = _RecordingSink()
    adapter = RuntimeEventAdapter(model_ref="fake/scripted", kind_of=lambda _name: "builtin")
    broker = RemoteActionBroker(sink=sink, adapter=adapter)
    event_id = await broker.announce_tool_use(
        kind="builtin",
        name="bash_exec",
        input={"command": "echo hi"},
        evaluated_policy="always_ask",
    )
    assert sink.batches[-1][1] is True
    assert sink.batches[-1][0][-1]["type"] == "agent.tool_use"
    waiting = asyncio.create_task(broker.request_action(event_id, "tool_confirmation"))
    for _ in range(10):
        await asyncio.sleep(0)
        if any(batch[0][-1]["type"] == "session.status_idle" for batch in sink.batches):
            break
    idle = next(
        batch[0][-1]
        for batch in sink.batches
        if batch[0][-1]["type"] == "session.status_idle"
    )
    assert idle["stop_reason"]["type"] == "requires_action"
    assert idle["stop_reason"]["event_ids"] == [event_id]
    allowed = UserToolConfirmation(
        type="user.tool_confirmation",
        tool_use_id=event_id,
        result="allow",
    )
    assert broker.deliver(allowed) is True
    assert await waiting is allowed
    assert broker.deliver(
        UserToolConfirmation(
            type="user.tool_confirmation",
            tool_use_id="missing1",
            result="deny",
        )
    ) is False
    second = await broker.announce_tool_use(
        kind="builtin",
        name="bash_exec",
        input={"command": "echo next"},
        evaluated_policy="always_ask",
    )
    parked = asyncio.create_task(broker.request_action(second, "tool_confirmation"))
    for _ in range(10):
        await asyncio.sleep(0)
        if second in broker._waiters:
            break
    mismatch = UserCustomToolResult(
        type="user.custom_tool_result",
        custom_tool_use_id=second,
        content=[{"type": "text", "text": "nope"}],
    )
    assert broker.deliver(mismatch) is False
    assert not parked.done()
    broker.void_all()
    assert await parked is None


class _LeaseClient:
    def __init__(self) -> None:
        self.completed = False
        self.failed = False
        self.heartbeats = 0

    async def ack(self, work_id: str, device_id: str) -> WorkItemRecord:
        del work_id, device_id
        return _work()

    async def heartbeat(self, work_id: str, device_id: str) -> WorkItemRecord:
        del work_id, device_id
        self.heartbeats += 1
        raise WorkLeaseLostError(409, "work_lease_lost", "lost")

    async def complete(
        self,
        work_id: str,
        device_id: str,
        consumed_through_seq: int,
    ) -> WorkItemRecord:
        del work_id, device_id, consumed_through_seq
        self.completed = True
        return _work()

    async def fail(self, work_id: str, device_id: str, error: str) -> WorkItemRecord:
        del work_id, device_id, error
        self.failed = True
        return _work()

    async def ingest(
        self,
        session_id: str,
        work_id: str,
        device_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        del session_id, work_id, device_id
        return list(events)

    async def list_events(
        self,
        session_id: str,
        *,
        after_seq: int = 0,
        limit: int = 500,
        types: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        del session_id, after_seq, limit, types
        return [], False

    async def inbox(
        self,
        session_id: str,
        work_id: str,
        device_id: str,
        *,
        after_seq: int,
    ) -> Any:
        del session_id, work_id, device_id, after_seq
        yield {
            "id": new_ulid(),
            "type": "user.message",
            "seq": 1,
            "content": [{"type": "text", "text": "hi"}],
        }
        await asyncio.Event().wait()


def _work() -> WorkItemRecord:
    return WorkItemRecord(
        id=new_ulid(),
        session_id=new_ulid(),
        environment_id="worker",
        status="running",
        claimed_by_device=_DEVICE,
        attempts=1,
    )


def _assignment() -> WorkAssignment:
    now = utc_now_iso()
    session_id = new_ulid()
    return WorkAssignment(
        work=WorkItemRecord(
            id=new_ulid(),
            session_id=session_id,
            environment_id="worker",
            status="claimed",
            claimed_by_device=_DEVICE,
            attempts=1,
        ),
        session=SessionRecord(
            id=session_id,
            tenant_id="dev",
            agent_id="demo",
            agent_version=1,
            environment_id="worker",
            source="api",
            status="idle",
            usage=Usage(),
            created_at=now,
            updated_at=now,
        ),
        agent_id="demo",
        agent_version=1,
        manifest={
            "schema": "agx.agent/v1",
            "model": "fake/scripted",
            "system": "Use bash.",
            "tools": [
                {
                    "type": "agx_builtin",
                    "default_policy": "always_allow",
                    "configs": [{"name": "bash_exec", "policy": "always_ask"}],
                }
            ],
            "runtime": {"max_tool_rounds": 4},
        },
        inbox_after_seq=0,
    )


async def test_runner_stops_on_lease_lost(tmp_path: Path) -> None:
    fake = _LeaseClient()
    runner = WorkItemRunner(
        client=fake,  # type: ignore[arg-type]
        device_id=_DEVICE,
        llm_factory=PerSessionScriptFactory(
            [ScriptStep("checking", [tool_call("bash_exec", {"command": "echo hi"}, "c1")])]
        ),
        workdir_root=tmp_path / "worker",
        heartbeat_interval=0.2,
        idle_complete_seconds=5,
    )
    await asyncio.wait_for(runner.run(_assignment()), timeout=3)
    assert fake.completed is False
    assert fake.failed is False
    assert fake.heartbeats >= 1


def test_cli_worker_requires_token() -> None:
    runner = CliRunner()
    missing = runner.invoke(app, ["ma", "worker", "--once"], env={"AGX_MA_DEV_TOKEN": ""})
    assert missing.exit_code == 2
    help_result = runner.invoke(app, ["ma", "worker", "--help"])
    assert help_result.exit_code == 0
    assert "--environment" in help_result.stdout


async def test_list_eligible_environments() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/work/environments") and request.method == "GET":
            if request.headers.get("authorization") == "Bearer denied":
                return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
            if "bad" in str(request.url):
                return httpx.Response(200, json={"data": 3})
            return httpx.Response(
                200,
                json={"data": [{"id": "W1", "name": "x"}, {"id": ""}]},
            )
        return httpx.Response(404, json={"error": {"code": "missing", "message": "no"}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, trust_env=False) as http:
        client = MAWorkerClient("http://ma.test", _TOKEN, http=http)
        assert await client.list_eligible_environments() == [{"id": "W1", "name": "x"}]
        denied = MAWorkerClient("http://ma.test", "denied", http=http)
        with pytest.raises(WorkerAuthError):
            await denied.list_eligible_environments()
        broken = MAWorkerClient("http://bad.test", _TOKEN, http=http)
        with pytest.raises(MAWorkerError) as exc:
            await broken.list_eligible_environments()
        assert exc.value.code == "invalid_response"
