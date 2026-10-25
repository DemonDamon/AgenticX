#!/usr/bin/env python3
"""Managed Agents host session API.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.managed.events import SqliteEventStore
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import HostConfig, Principal
from agenticx.managed.ids import is_ulid, new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord, Usage
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, tool_call
from tests.managed.conftest import make_config

SessionPredicate = Callable[[dict[str, Any]], bool]


def _plain_manifest() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Reply with the scripted text.",
        "runtime": {"max_tool_rounds": 4},
    }


def _bash_manifest(policy: str) -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Use bash when asked.",
        "tools": [
            {
                "type": "agx_builtin",
                "default_policy": "always_allow",
                "configs": [{"name": "bash_exec", "policy": policy}],
            }
        ],
        "runtime": {"max_tool_rounds": 8},
    }


def _custom_manifest() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Call lookup_order.",
        "tools": [
            {
                "type": "custom",
                "name": "lookup_order",
                "description": "Look up an order.",
                "input_schema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                    "required": ["order_id"],
                },
            }
        ],
        "runtime": {"max_tool_rounds": 8},
    }


def _user_message(text: str) -> dict[str, str | list[dict[str, str]]]:
    return {"type": "user.message", "content": [{"type": "text", "text": text}]}


def _block_text(event: dict[str, Any]) -> str:
    content = event.get("content") or []
    if not isinstance(content, list) or not content or not isinstance(content[0], dict):
        return ""
    text = content[0].get("text")
    return text if isinstance(text, str) else ""


@asynccontextmanager
async def _client(app: Any, token: str | None = "test-token", *, lifecycle: bool = True) -> Any:
    if lifecycle:
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
            if lifecycle:
                await app.state.ma.shutdown()


async def wait_for_session(
    client: httpx.AsyncClient,
    session_id: str,
    predicate: SessionPredicate,
    timeout: float = 15,
) -> dict[str, Any]:
    """GET the session every 0.1s until ``predicate`` accepts it."""
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        if predicate(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(last)


async def _events(client: httpx.AsyncClient, session_id: str, **params: Any) -> list[dict[str, Any]]:
    response = await client.get(f"/ma/v1/sessions/{session_id}/events", params=params or {"limit": 500})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert isinstance(data, list)
    return data


async def _wait_events(
    client: httpx.AsyncClient,
    session_id: str,
    predicate: Callable[[list[dict[str, Any]]], bool],
    timeout: float = 15,
) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    last: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        last = await _events(client, session_id)
        if predicate(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError([(row["seq"], row["type"]) for row in last])


async def _create(client: httpx.AsyncClient, **body: Any) -> httpx.Response:
    return await client.post("/ma/v1/sessions", json={"agent_id": "demo", **body})


def _idle(stop_type: str) -> SessionPredicate:
    def accept(record: dict[str, Any]) -> bool:
        stop = record.get("stop_reason") or {}
        return record.get("status") == "idle" and stop.get("type") == stop_type

    return accept


async def test_auth_401_and_403(tmp_path: Path) -> None:
    reader = Principal(tenant_id="dev", user_id="reader", scopes=frozenset({"ma:sessions:read"}))
    config = make_config(
        tmp_path,
        manifest=_plain_manifest(),
        tokens={
            "test-token": Principal(
                tenant_id="dev",
                user_id="dev-user",
                scopes=frozenset({"ma:sessions:read", "ma:sessions:write", "ma:admin"}),
            ),
            "read-token": reader,
        },
    )
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    await app.state.ma.startup()
    try:
        async with _client(app, token=None, lifecycle=False) as anon:
            health = await anon.get("/ma/v1/health")
            assert health.status_code == 200
            assert health.json()["ok"] is True
            missing = await anon.post("/ma/v1/sessions", json={"agent_id": "demo"})
            assert missing.status_code == 401
            assert missing.json()["error"]["code"] == "unauthorized"
        async with _client(app, token="nope", lifecycle=False) as bad:
            rejected = await bad.post("/ma/v1/sessions", json={"agent_id": "demo"})
            assert rejected.status_code == 401
            assert rejected.json()["error"]["code"] == "unauthorized"
        async with _client(app, token="read-token", lifecycle=False) as reader_client: # gitleaks:allow
            forbidden = await reader_client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            assert forbidden.status_code == 403
            assert forbidden.json()["error"]["code"] == "forbidden_scope"
    finally:
        await app.state.ma.shutdown()


async def test_create_and_get_session(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    async with _client(app) as client:
        created = await _create(client)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["status"] == "idle"
        assert body["agent_version"] == 1
        assert body["environment_id"] == "local"
        assert is_ulid(body["id"])
        assert body["usage"]["input_tokens"] == 0
        fetched = await client.get(f"/ma/v1/sessions/{body['id']}")
        assert fetched.status_code == 200
        assert fetched.json() == body
        unknown_agent = await client.post("/ma/v1/sessions", json={"agent_id": "missing"})
        assert unknown_agent.status_code == 404
        assert unknown_agent.json()["error"]["code"] == "agent_not_found"
        unknown_version = await _create(client, agent_version=9)
        assert unknown_version.status_code == 404
        assert unknown_version.json()["error"]["code"] == "agent_version_not_found"
        unknown_env = await _create(client, environment_id="nope")
        assert unknown_env.status_code == 404
        assert unknown_env.json()["error"]["code"] == "environment_not_found"
        assert app.state.ma.service.supports_environment("desktop_worker")
        vaults = await _create(client, vault_ids=["x"])
        assert vaults.status_code == 400
        extra = await client.post("/ma/v1/sessions", json={"agent_id": "demo", "extra": 1})
        assert extra.status_code == 400
        assert extra.json()["error"]["code"] == "invalid_request"


async def test_message_runs_turn_to_end_turn(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi there")]))
    async with _client(app) as client:
        created = await _create(client)
        session_id = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("hello")]},
        )
        assert posted.status_code == 200, posted.text
        events = posted.json()["events"]
        assert len(events) == 1
        assert events[0]["type"] == "user.message"
        assert events[0]["seq"] == 1
        await wait_for_session(client, session_id, _idle("end_turn"), timeout=10)
        rows = await _events(client, session_id)
        assert [row["type"] for row in rows] == [
            "user.message",
            "session.status_running",
            "span.model_request_start",
            "span.model_request_end",
            "agent.message",
            "session.usage",
            "session.status_idle",
        ]
        message = next(row for row in rows if row["type"] == "agent.message")
        assert _block_text(message) == "hi there"


async def test_event_batch_validation(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    async with _client(app) as client:
        created = await _create(client)
        session_id = created.json()["id"]
        url = f"/ma/v1/sessions/{session_id}/events"
        empty = await client.post(url, json={"events": []})
        assert empty.status_code == 400
        assert empty.json()["error"]["code"] == "invalid_event_batch"
        too_many = await client.post(url, json={"events": [_user_message(str(i)) for i in range(11)]})
        assert too_many.status_code == 400
        assert too_many.json()["error"]["code"] == "invalid_event_batch"
        unknown = await client.post(url, json={"events": [{"type": "user.nope"}]})
        assert unknown.status_code == 400
        assert unknown.json()["error"]["code"] == "invalid_event_batch"
        assert unknown.json()["error"]["details"]["index"] == 0
        tool_use_id = new_ulid()
        duplicate = await client.post(
            url,
            json={
                "events": [
                    {"type": "user.tool_confirmation", "tool_use_id": tool_use_id, "result": "allow"},
                    {"type": "user.tool_confirmation", "tool_use_id": tool_use_id, "result": "deny"},
                ]
            },
        )
        assert duplicate.status_code == 400
        assert duplicate.json()["error"]["code"] == "duplicate_resolution"
        assert await _events(client, session_id) == []


async def _bash_turn(
    tmp_path: Path,
    *,
    policy: str,
    steps: list[ScriptStep],
) -> tuple[HostConfig, Any, PerSessionScriptFactory]:
    config = make_config(tmp_path, manifest=_bash_manifest(policy))
    factory = PerSessionScriptFactory(steps)
    app = create_ma_app(config, llm_factory=factory)
    return config, app, factory


async def test_requires_action_rules(tmp_path: Path) -> None:
    _config, app, _factory = await _bash_turn(
        tmp_path,
        policy="always_ask",
        steps=[
            ScriptStep("checking", [tool_call("bash_exec", {"command": "echo hi"}, "c1")]),
            ScriptStep("done"),
        ],
    )
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("go")]},
        )
        assert posted.status_code == 200, posted.text
        record = await wait_for_session(client, session_id, _idle("requires_action"))
        tool_use_id = record["stop_reason"]["event_ids"][0]
        rejected = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("later")]},
        )
        assert rejected.status_code == 409
        assert rejected.json()["error"]["code"] == "session_requires_action"
        assert rejected.json()["error"]["details"]["event_ids"] == [tool_use_id]
        missing = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {"type": "user.tool_confirmation", "tool_use_id": new_ulid(), "result": "allow"}
                ]
            },
        )
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "resolution_not_found"
        wrong_kind = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {
                        "type": "user.custom_tool_result",
                        "custom_tool_use_id": tool_use_id,
                        "content": [{"type": "text", "text": "nope"}],
                    }
                ]
            },
        )
        assert wrong_kind.status_code == 400
        assert wrong_kind.json()["error"]["code"] == "invalid_request"
        allowed = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {"type": "user.tool_confirmation", "tool_use_id": tool_use_id, "result": "allow"}
                ]
            },
        )
        assert allowed.status_code == 200, allowed.text
        await _wait_events(
            client,
            session_id,
            lambda rows: any(row["type"] == "session.status_running" and row["seq"] > 1 for row in rows),
        )
        await wait_for_session(client, session_id, _idle("end_turn"))


async def test_tool_confirmation_deny(tmp_path: Path) -> None:
    config, app, _factory = await _bash_turn(
        tmp_path,
        policy="always_ask",
        steps=[
            ScriptStep("touching", [tool_call("bash_exec", {"command": "touch marker.txt"}, "c1")]),
            ScriptStep("done"),
        ],
    )
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("go")]},
        )
        record = await wait_for_session(client, session_id, _idle("requires_action"))
        tool_use_id = record["stop_reason"]["event_ids"][0]
        denied = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {
                        "type": "user.tool_confirmation",
                        "tool_use_id": tool_use_id,
                        "result": "deny",
                        "deny_message": "no",
                    }
                ]
            },
        )
        assert denied.status_code == 200, denied.text
        await wait_for_session(client, session_id, _idle("end_turn"))
        rows = await _events(client, session_id)
        result = next(row for row in rows if row["type"] == "agent.tool_result")
        assert result["is_error"] is True
        assert "CANCELLED: tool use denied by user: no" in _block_text(result)
        marker = config.workdir_root / session_id / "work" / "marker.txt"
        assert marker.exists() is False


async def test_custom_tool_roundtrip(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_custom_manifest())
    factory = PerSessionScriptFactory(
        [
            ScriptStep("looking", [tool_call("lookup_order", {"order_id": "A-1"}, "c1")]),
            ScriptStep("done"),
        ]
    )
    app = create_ma_app(config, llm_factory=factory)
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("where")]},
        )
        record = await wait_for_session(client, session_id, _idle("requires_action"))
        custom_id = record["stop_reason"]["event_ids"][0]
        rows = await _events(client, session_id)
        custom = next(row for row in rows if row["id"] == custom_id)
        assert custom["type"] == "agent.custom_tool_use"
        assert custom["input"] == {"order_id": "A-1"}
        answered = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {
                        "type": "user.custom_tool_result",
                        "custom_tool_use_id": custom_id,
                        "content": [{"type": "text", "text": "shipped"}],
                    }
                ]
            },
        )
        assert answered.status_code == 200, answered.text
        await wait_for_session(client, session_id, _idle("end_turn"))
        calls = factory.by_session[session_id].calls
        assert len(calls) >= 2
        tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
        assert any(item.get("content") == "shipped" for item in tool_messages), calls[1]["messages"]


async def test_interrupt_during_requires_action(tmp_path: Path) -> None:
    _config, app, _factory = await _bash_turn(
        tmp_path,
        policy="always_ask",
        steps=[
            ScriptStep("checking", [tool_call("bash_exec", {"command": "echo hi"}, "c1")]),
            ScriptStep("done"),
        ],
    )
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("go")]},
        )
        await wait_for_session(client, session_id, _idle("requires_action"))
        interrupted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        assert interrupted.status_code == 200, interrupted.text
        await wait_for_session(client, session_id, _idle("end_turn"))
        rows = await _events(client, session_id)
        result = next(row for row in rows if row["type"] == "agent.tool_result")
        assert _block_text(result).startswith("CANCELLED: interrupted")
        follow = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("next")]},
        )
        assert follow.status_code == 200, follow.text
        await wait_for_session(client, session_id, _idle("end_turn"))


async def test_interrupt_running_tool_within_grace(tmp_path: Path) -> None:
    _config, app, _factory = await _bash_turn(
        tmp_path,
        policy="always_allow",
        steps=[
            ScriptStep("sleeping", [tool_call("bash_exec", {"command": "sleep 30"}, "c1")]),
            ScriptStep("stopped"),
        ],
    )
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("go")]},
        )
        await _wait_events(
            client,
            session_id,
            lambda rows: any(row["type"] == "agent.tool_use" for row in rows),
        )
        started = time.monotonic()
        interrupted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        assert interrupted.status_code == 200, interrupted.text
        await wait_for_session(client, session_id, _idle("end_turn"), timeout=10)
        assert time.monotonic() - started < 10


async def test_two_messages_queue_sequentially(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    factory = PerSessionScriptFactory([ScriptStep("a1"), ScriptStep("a2")])
    app = create_ma_app(config, llm_factory=factory)
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("q1"), _user_message("q2")]},
        )
        assert posted.status_code == 200, posted.text
        rows = await _wait_events(
            client,
            session_id,
            lambda found: len([row for row in found if row["type"] == "session.status_idle"]) >= 2,
        )
        running = [row for row in rows if row["type"] == "session.status_running"]
        idle = [
            row
            for row in rows
            if row["type"] == "session.status_idle" and row["stop_reason"]["type"] == "end_turn"
        ]
        assert len(running) == 2
        assert len(idle) == 2
        assert running[1]["seq"] > idle[0]["seq"]
        calls = factory.by_session[session_id].calls
        assert any("a1" in str(item.get("content")) for item in calls[1]["messages"])


async def test_list_events_pagination(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi there")]))
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("hello")]},
        )
        await wait_for_session(client, session_id, _idle("end_turn"), timeout=10)
        page = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 3})
        assert page.status_code == 200, page.text
        payload = page.json()
        assert len(payload["data"]) == 3
        assert payload["has_more"] is True
        assert payload["next_after_seq"] == 3
        filtered = await client.get(
            f"/ma/v1/sessions/{session_id}/events",
            params={"after_seq": 3, "types": "agent.message"},
        )
        assert filtered.status_code == 200
        assert filtered.json()["data"]
        assert {row["type"] for row in filtered.json()["data"]} == {"agent.message"}
        bogus = await client.get(
            f"/ma/v1/sessions/{session_id}/events",
            params={"types": "bogus"},
        )
        assert bogus.status_code == 400
        zero = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 0})
        assert zero.status_code == 400


async def test_archive(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi"), ScriptStep("later")]))
    async with _client(app) as client:
        session_id = (await _create(client)).json()["id"]
        archived = await client.post(f"/ma/v1/sessions/{session_id}/archive")
        assert archived.status_code == 200, archived.text
        body = archived.json()
        assert body["status"] == "archived"
        assert body["archived_at"]
        rejected = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("nope")]},
        )
        assert rejected.status_code == 409
        assert rejected.json()["error"]["code"] == "session_terminated"
        again = await client.post(f"/ma/v1/sessions/{session_id}/archive")
        assert again.status_code == 400

    running_config = make_config(tmp_path / "running", manifest=_bash_manifest("always_allow"))
    running_app = create_ma_app(
        running_config,
        llm_factory=PerSessionScriptFactory(
            [
                ScriptStep("sleeping", [tool_call("bash_exec", {"command": "sleep 30"}, "c1")]),
                ScriptStep("done"),
            ]
        ),
    )
    async with _client(running_app) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("go")]},
        )
        await wait_for_session(client, session_id, lambda record: record.get("status") == "running")
        busy = await client.post(f"/ma/v1/sessions/{session_id}/archive")
        assert busy.status_code == 400
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        await wait_for_session(client, session_id, _idle("end_turn"), timeout=10)


async def test_startup_recovers_unsettled_sessions(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    store = SqliteEventStore(config.db_path)
    now = utc_now_iso()
    session_id = new_ulid()
    await store.create_session(
        SessionRecord(
            id=session_id,
            tenant_id="dev",
            agent_id="demo",
            agent_version=1,
            environment_id="local",
            created_by_user_id="dev-user",
            source="api",
            status="running",
            stop_reason=None,
            title=None,
            vault_ids=[],
            resources=[],
            usage=Usage(),
            created_at=now,
            updated_at=now,
            archived_at=None,
        )
    )
    app = create_ma_app(
        config,
        llm_factory=PerSessionScriptFactory([ScriptStep("hi")]),
        store=store,
    )
    await app.state.ma.startup()
    try:
        record = await store.get_session("dev", session_id)
        assert record is not None
        assert record.status == "idle"
        assert record.stop_reason is not None
        assert record.stop_reason.type == "retries_exhausted"
        rows = await store.list_events("dev", session_id, limit=20)
        errors = [row for row in rows if row.type == "session.error"]
        assert errors
        assert errors[0].payload["error"]["type"] == "host_restarted"
    finally:
        await app.state.ma.shutdown()


async def test_history_rehydrated_after_restart(tmp_path: Path) -> None:
    config = make_config(tmp_path, manifest=_plain_manifest())
    first = PerSessionScriptFactory([ScriptStep("a1")])
    app1 = create_ma_app(config, llm_factory=first)
    async with _client(app1) as client:
        session_id = (await _create(client)).json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("q1")]},
        )
        await wait_for_session(client, session_id, _idle("end_turn"))
    second = PerSessionScriptFactory([ScriptStep("a2")])
    app2 = create_ma_app(config, llm_factory=second)
    async with _client(app2) as client:
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user_message("q2")]},
        )
        await wait_for_session(client, session_id, _idle("end_turn"))
    blob = [str(item.get("content")) for item in second.by_session[session_id].calls[0]["messages"]]
    joined = "\n".join(blob)
    assert joined.index("q1") < joined.index("a1") < joined.index("q2")