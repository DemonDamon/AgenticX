#!/usr/bin/env python3
"""Host work-queue routes for desktop workers.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from agenticx.managed.events.state_machine import status_idle_event, status_running_event
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import Principal
from agenticx.managed.host.ingest import stop_expired_work
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.sse import aiter_sse
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep
from agenticx.runtime.credential_store import redact_text
from tests.managed.conftest import dev_principal, make_config

_DEVICE = "device-01"


def _plain() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Reply briefly.",
        "runtime": {"max_tool_rounds": 4},
    }


def _message(text: str) -> dict[str, Any]:
    return {"type": "user.message", "content": [{"type": "text", "text": text}]}


@asynccontextmanager
async def _client(
    app: Any,
    token: str | None = "test-token",
) -> AsyncIterator[httpx.AsyncClient]:
    await app.state.ma.startup()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers=headers,
        timeout=30,
        trust_env=False,
    ) as client:
        try:
            yield client
        finally:
            await app.state.ma.shutdown()


def _app(tmp_path: Path, *, tokens: dict[str, Principal] | None = None) -> Any:
    config = make_config(tmp_path, manifest=_plain(), tokens=tokens)
    return create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))


async def _open_worker_session(client: httpx.AsyncClient) -> str:
    created = await client.post(
        "/ma/v1/sessions",
        json={"agent_id": "demo", "environment_id": "worker"},
    )
    assert created.status_code == 201, created.text
    return str(created.json()["id"])


async def _events(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"/ma/v1/sessions/{session_id}/events",
        params={"limit": 500},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert isinstance(data, list)
    return data


async def test_worker_environment_sessions_enqueue_work(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        session_id = await _open_worker_session(client)
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_message("hello")]},
        )
        assert posted.status_code == 200, posted.text
        item = app.state.ma.extras["work_queue"].active_for_session("dev", session_id)
        assert item is not None
        assert item.status == "queued"
        assert item.inbox_after_seq == 0
        record = await client.get(f"/ma/v1/sessions/{session_id}")
        assert record.json()["status"] == "idle"


async def test_poll_long_wait_returns_null(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        started = time.monotonic()
        response = await client.post(
            "/ma/v1/environments/worker/work/poll",
            json={"device_id": _DEVICE, "max_wait_seconds": 1},
        )
        elapsed = time.monotonic() - started
        assert response.status_code == 200, response.text
        assert response.json() == {"work": None}
        assert elapsed >= 0.9
        assert elapsed < 5


async def test_poll_wakes_on_new_work(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("hi")]))
    async with httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        session_id = await _open_worker_session(client)

        async def _poll() -> httpx.Response:
            return await client.post(
                "/ma/v1/environments/worker/work/poll",
                json={"device_id": _DEVICE, "max_wait_seconds": 10},
            )

        task = asyncio.create_task(_poll())
        await asyncio.sleep(0.3)
        assert not task.done()
        started = time.monotonic()
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_message("hello")]},
        )
        assert posted.status_code == 200, posted.text
        response = await asyncio.wait_for(task, timeout=3)
        assert time.monotonic() - started < 3
        body = response.json()
        assert body["session"]["id"] == session_id
        assert body["agent"]["version"] == 1
        assert body["agent"]["manifest"]["schema"] == "agx.agent/v1"
        assert body["inbox_after_seq"] == 0
        assert body["work"]["status"] == "claimed"


async def test_poll_validation_and_scope(tmp_path: Path) -> None:
    tokens = {
        "test-token": dev_principal("dev"),
        "read-token": Principal(
            tenant_id="dev",
            user_id="reader",
            scopes=frozenset({"ma:sessions:read"}),
        ),
    }
    app = _app(tmp_path, tokens=tokens)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            cloud = await client.post(
                "/ma/v1/environments/local/work/poll",
                json={"device_id": _DEVICE, "max_wait_seconds": 0},
            )
            assert cloud.status_code == 400
            assert cloud.json()["error"]["code"] == "invalid_request"
            missing = await client.post(
                "/ma/v1/environments/missing-env/work/poll",
                json={"device_id": _DEVICE, "max_wait_seconds": 0},
            )
            assert missing.status_code == 404
            assert missing.json()["error"]["code"] == "environment_not_found"
            short = await client.post(
                "/ma/v1/environments/worker/work/poll",
                json={"device_id": "x", "max_wait_seconds": 0},
            )
            assert short.status_code == 400
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer read-token"},
            timeout=30,
            trust_env=False,
        ) as reader:
            forbidden = await reader.post(
                "/ma/v1/environments/worker/work/poll",
                json={"device_id": _DEVICE, "max_wait_seconds": 0},
            )
            assert forbidden.status_code == 403
            assert forbidden.json()["error"]["code"] == "forbidden_scope"
    finally:
        await app.state.ma.shutdown()


async def _claim(client: httpx.AsyncClient, session_id: str) -> str:
    await client.post(
        f"/ma/v1/sessions/{session_id}/events",
        json={"events": [_message("hello")]},
    )
    polled = await client.post(
        "/ma/v1/environments/worker/work/poll",
        json={"device_id": _DEVICE, "max_wait_seconds": 0},
    )
    assert polled.status_code == 200, polled.text
    work_id = str(polled.json()["work"]["id"])
    acked = await client.post(
        f"/ma/v1/work/{work_id}/ack",
        json={"device_id": _DEVICE},
    )
    assert acked.status_code == 200, acked.text
    assert acked.json()["work"]["status"] == "running"
    return work_id


async def test_ingest_assigns_seq_and_validates(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        session_id = await _open_worker_session(client)
        work_id = await _claim(client, session_id)
        message_id = new_ulid()
        ingested = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [
                    status_running_event(),
                    {
                        "id": message_id,
                        "type": "agent.message",
                        "content": [{"type": "text", "text": "hi"}],
                    },
                ],
            },
        )
        assert ingested.status_code == 200, ingested.text
        stored = ingested.json()["events"]
        assert [item["seq"] for item in stored] == [2, 3]
        record = await client.get(f"/ma/v1/sessions/{session_id}")
        assert record.json()["status"] == "running"
        rejected = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [_message("nope")],
            },
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "invalid_event_batch"
        before = await _events(client, session_id)
        again = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [status_running_event()],
            },
        )
        assert again.status_code == 400
        assert again.json()["error"]["code"] == "invalid_event_batch"
        after = await _events(client, session_id)
        assert after[-1]["seq"] == before[-1]["seq"]
        assert (await client.get(f"/ma/v1/sessions/{session_id}")).json()["status"] == "running"
        wrong = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": "device-02",
                "events": [status_running_event()],
            },
        )
        assert wrong.status_code == 409
        assert wrong.json()["error"]["code"] == "work_lease_lost"
        tool_id = new_ulid()
        waiting = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [
                    {
                        "id": tool_id,
                        "type": "agent.tool_use",
                        "name": "bash_exec",
                        "input": {"command": "echo hi"},
                        "evaluated_policy": "always_ask",
                    },
                    status_idle_event("requires_action", [tool_id]),
                ],
            },
        )
        assert waiting.status_code == 200, waiting.text
        parked = await client.get(f"/ma/v1/sessions/{session_id}")
        assert parked.json()["stop_reason"]["type"] == "requires_action"
        blocked = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_message("later")]},
        )
        assert blocked.status_code == 409
        assert blocked.json()["error"]["code"] == "session_requires_action"


async def test_inbox_streams_client_events_after_cursor(
    tmp_path: Path,
    ma_live_server: Any,
) -> None:
    config = make_config(tmp_path, manifest=_plain())
    config.sse_ping_seconds = 30
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("hi")]))
    async with httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        session_id = await _open_worker_session(client)
        work_id = await _claim(client, session_id)
        seen: list[dict[str, Any]] = []
        got_message = asyncio.Event()
        got_interrupt = asyncio.Event()

        async def _read() -> None:
            async with client.stream(
                "GET",
                f"/ma/v1/sessions/{session_id}/inbox/stream",
                params={"work_id": work_id, "device_id": _DEVICE},
            ) as response:
                assert response.status_code == 200, await response.aread()
                async for message in aiter_sse(response.aiter_lines()):
                    payload = message.json()
                    seen.append(payload)
                    if payload.get("type") == "user.message":
                        got_message.set()
                    if payload.get("type") == "user.interrupt":
                        got_interrupt.set()
                        return

        task = asyncio.create_task(_read())
        await asyncio.wait_for(got_message.wait(), timeout=5)
        hidden = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [
                    {
                        "id": new_ulid(),
                        "type": "agent.message",
                        "content": [{"type": "text", "text": "hidden"}],
                    }
                ],
            },
        )
        assert hidden.status_code == 200, hidden.text
        await asyncio.sleep(0.3)
        assert all(item.get("type") != "agent.message" for item in seen)
        interrupted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        assert interrupted.status_code == 200, interrupted.text
        await asyncio.wait_for(got_interrupt.wait(), timeout=5)
        task.cancel()
        rows = await _events(client, session_id)
        client_rows = [
            row for row in rows if row["type"] in {"user.message", "user.interrupt"}
        ]
        assert client_rows
        assert all(row.get("processed_at") for row in client_rows)


async def test_complete_creates_followup_item_for_unconsumed_messages(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        session_id = await _open_worker_session(client)
        work_id = await _claim(client, session_id)
        settled = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [
                    status_running_event(),
                    status_idle_event("end_turn"),
                ],
            },
        )
        assert settled.status_code == 200, settled.text
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_message("again")]},
        )
        assert posted.status_code == 200, posted.text
        follow_seq = int(posted.json()["events"][0]["seq"])
        done = await client.post(
            f"/ma/v1/work/{work_id}/complete",
            json={"device_id": _DEVICE, "consumed_through_seq": follow_seq - 1},
        )
        assert done.status_code == 200, done.text
        assert done.json()["work"]["status"] == "completed"
        queued = app.state.ma.extras["work_queue"].active_for_session("dev", session_id)
        assert queued is not None
        assert queued.status == "queued"
        assert queued.inbox_after_seq == follow_seq - 1


async def test_fail_marks_session(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        session_id = await _open_worker_session(client)
        work_id = await _claim(client, session_id)
        running = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [status_running_event()],
            },
        )
        assert running.status_code == 200, running.text
        raw = "Bearer abc123 " + ("y" * 700)
        failed = await client.post(
            f"/ma/v1/work/{work_id}/fail",
            json={"device_id": _DEVICE, "error": raw},
        )
        assert failed.status_code == 200, failed.text
        assert failed.json()["work"]["status"] == "failed"
        rows = await _events(client, session_id)
        error = next(row for row in rows if row["type"] == "session.error")
        assert error["error"]["type"] == "worker_failed"
        message = error["error"]["message"]
        assert message == redact_text(raw)[:500]
        assert len(message) <= 500
        idle = next(row for row in rows if row["type"] == "session.status_idle")
        assert idle["stop_reason"]["type"] == "retries_exhausted"


async def test_sweeper_stops_lost_work(tmp_path: Path) -> None:
    app = _app(tmp_path)
    async with _client(app) as client:
        session_id = await _open_worker_session(client)
        work_id = await _claim(client, session_id)
        running = await client.post(
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": _DEVICE,
                "events": [status_running_event()],
            },
        )
        assert running.status_code == 200, running.text
        queue = app.state.ma.extras["work_queue"]
        store = app.state.ma.store
        stale = utc_now_iso(datetime.now(timezone.utc) - timedelta(seconds=400))
        with store.lock:
            store.connection.execute(
                "UPDATE ma_work_items SET lease_expires_at = ? WHERE id = ?",
                (stale, work_id),
            )
        stopped = await stop_expired_work(app.state.ma.service, queue)
        assert stopped == 1
        item = queue.get("dev", work_id)
        assert item is not None
        assert item.status == "stopped"
        rows = await _events(client, session_id)
        error = next(row for row in rows if row["type"] == "session.error")
        assert error["error"]["type"] == "worker_lost"
        idle = next(row for row in rows if row["type"] == "session.status_idle")
        assert idle["stop_reason"]["type"] == "retries_exhausted"
        assert queue.claim_next("dev", "worker", _DEVICE) is None
