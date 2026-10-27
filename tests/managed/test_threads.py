#!/usr/bin/env python3
"""Multi-agent member threads: delegation, reports, limits, and interrupts.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any, AsyncIterator

import httpx
import pytest

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import (
    AgentDefinition,
    HostConfig,
    default_environments,
    dev_principal,
)
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.manifest import validate_manifest
from agenticx.managed.protocol import AgentRecord, AgentVersionRecord
from agenticx.managed.testing import ScriptStep, ScriptedLLM, ThreadScriptFactory, tool_call
from agenticx.runtime.effect_guard import resolve_session_id


def _manifest(
    *,
    tools: list[dict[str, Any]] | None = None,
    multiagent: dict[str, Any] | None = None,
    rounds: int = 8,
) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "test agent",
        "runtime": {"max_tool_rounds": rounds},
        "tools": [{"type": "agx_builtin"}] if tools is None else tools,
    }
    if multiagent is not None:
        raw["multiagent"] = multiagent
    return raw


def _definition(
    agent_id: str,
    name: str,
    manifest: dict[str, Any],
    *,
    status: str = "active",
    description: str | None = None,
) -> AgentDefinition:
    result = validate_manifest(manifest)
    assert result.ok and result.normalized is not None and result.manifest_hash is not None, result.errors
    now = utc_now_iso()
    record = AgentRecord(
        id=agent_id,
        tenant_id="dev",
        slug=agent_id.lower(),
        display_name=name,
        description=description,
        latest_version=1,
        status=status,  # type: ignore[arg-type]
        lifecycle="published",
        origin="enterprise",
        assignment_keys=[],
        worker_keys=[],
        default_environment_id="local",
    )
    version = AgentVersionRecord(
        agent_id=agent_id,
        version=1,
        manifest=result.normalized,
        manifest_hash=result.manifest_hash,
        created_by=None,
        created_at=now,
        note=None,
    )
    return AgentDefinition(record=record, versions={1: version})


def host_config(
    tmp_path: Path,
    agents: dict[str, AgentDefinition],
    *,
    threads: bool = True,
) -> HostConfig:
    data_dir = tmp_path / "ma-host"
    data_dir.mkdir(parents=True, exist_ok=True)
    config = HostConfig(
        data_dir=data_dir,
        tenant_id="dev",
        tokens={"test-token": dev_principal("dev")},
        agents=agents,
        environments=default_environments("dev"),
        dev=True,
    )
    config.threads_enabled = threads
    return config


def coordinator_agents(
    *,
    advisor: bool = False,
    member_manifest: dict[str, Any] | None = None,
    member_status: str = "active",
    member_name: str = "Member B",
) -> dict[str, AgentDefinition]:
    members: list[dict[str, Any]] = [
        {"type": "self"},
        {"type": "agent", "id": "B", "version": 1},
    ]
    if advisor:
        members.append({"type": "advisor", "model": "fake/scripted", "instructions": "be brief"})
    return {
        "C": _definition(
            "C",
            "协调者",
            _manifest(multiagent={"type": "coordinator", "agents": members}),
        ),
        "B": _definition(
            "B",
            member_name,
            member_manifest or _manifest(),
            status=member_status,
            description="writes files",
        ),
    }


@asynccontextmanager
async def hosted(
    config: HostConfig,
    factory: Any,
) -> AsyncIterator[tuple[Any, httpx.AsyncClient]]:
    app = create_ma_app(config, llm_factory=factory)
    await app.state.ma.startup()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://ma",
        headers={"Authorization": "Bearer test-token"},
        timeout=30,
        trust_env=False,
    ) as client:
        try:
            yield app, client
        finally:
            await app.state.ma.shutdown()


async def create_session(client: httpx.AsyncClient, agent_id: str = "C", **extra: Any) -> str:
    created = await client.post("/ma/v1/sessions", json={"agent_id": agent_id, **extra})
    assert created.status_code == 201, created.text
    return str(created.json()["id"])


async def post_event(client: httpx.AsyncClient, session_id: str, event: dict[str, Any]) -> httpx.Response:
    return await client.post(f"/ma/v1/sessions/{session_id}/events", json={"events": [event]})


async def events_of(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def wait_idle(client: httpx.AsyncClient, session_id: str, timeout: float = 8) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    last: dict[str, Any] = {}
    while asyncio.get_running_loop().time() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        reason = last.get("stop_reason") or {}
        if last.get("status") == "idle" and reason.get("type") == "end_turn":
            return
        await asyncio.sleep(0.05)
    rows = await events_of(client, session_id)
    raise AssertionError(
        {
            "status": last.get("status"),
            "stop": (last.get("stop_reason") or {}).get("type"),
            "events": [(row["type"], row.get("thread_id")) for row in rows],
        }
    )


def message_text(event: dict[str, Any]) -> str:
    parts: list[str] = []
    for block in event.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return "\n".join(parts)


def tool_result_text(event: dict[str, Any]) -> str:
    return message_text(event)


def user_message(text: str, **extra: Any) -> dict[str, Any]:
    event = {"type": "user.message", "content": [{"type": "text", "text": text}]}
    event.update(extra)
    return event


class _UsageLLM(ScriptedLLM):
    def __init__(self, steps: list[ScriptStep], prompt: int, completion: int) -> None:
        super().__init__(steps)
        self._prompt = prompt
        self._completion = completion

    def invoke(self, messages: Any, **kwargs: Any) -> Any:
        response = super().invoke(messages, **kwargs)
        response.usage = SimpleNamespace(
            prompt_tokens=self._prompt,
            completion_tokens=self._completion,
            total_tokens=self._prompt + self._completion,
        )
        return response


class _UsageFactory(ThreadScriptFactory):
    def __init__(self, scripts: dict[str, list[ScriptStep]]) -> None:
        super().__init__(scripts)
        self._prompts = {"primary": (10, 5), "agent:B": (7, 3)}

    def create(self, *, provider: str, model: str, context: Any) -> ScriptedLLM:
        del provider, model
        slot = context.thread_id or "primary"
        key = (context.session_id, slot)
        existing = self._llms.get(key)
        if existing is not None:
            return existing
        from agenticx.managed.testing import _script_role

        role = _script_role(context)
        prompt, completion = self._prompts.get(role, (10, 5))
        llm = _UsageLLM(list(self._scripts.get(role, ())), prompt, completion)
        self._llms[key] = llm
        return llm


async def test_send_to_agent_runs_member_and_reports_back(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep(
                    "sending",
                    [tool_call("send_to_agent", {"agent": "B", "message": "write hi to out/b.txt"}, "c1")],
                ),
                ScriptStep("waiting"),
                ScriptStep("all done"),
            ],
            "agent:B": [
                ScriptStep(
                    "writing",
                    [tool_call("file_write", {"path": "out/b.txt", "content": "hi"}, "b1")],
                ),
                ScriptStep("wrote it"),
            ],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        posted = await post_event(client, session_id, user_message("go"))
        assert posted.status_code == 200, posted.text
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
        record = (await client.get(f"/ma/v1/sessions/{session_id}")).json()
    written = config.workdir_root / session_id / "work" / "out" / "b.txt"
    assert written.read_text(encoding="utf-8") == "hi"
    delivered = [
        json.loads(tool_result_text(row))
        for row in rows
        if row["type"] == "agent.tool_result" and tool_result_text(row).startswith("{")
    ]
    assert delivered and delivered[0]["delivered"] is True
    order = [
        "session.thread_created",
        "agent.thread_message_sent",
        "session.thread_status_running",
        "session.thread_status_idle",
        "agent.thread_message_received",
    ]
    cursor = 0
    positions: dict[str, int] = {}
    for index, row in enumerate(rows):
        if cursor < len(order) and row["type"] == order[cursor]:
            positions[order[cursor]] = index
            cursor += 1
    assert cursor == len(order)
    received = next(
        row for row in rows if row["type"] == "agent.thread_message_received"
    )
    assert received["from_agent_name"] == "Member B"
    done = next(
        index
        for index, row in enumerate(rows)
        if row["type"] == "agent.message" and message_text(row) == "all done"
    )
    idle = next(
        index
        for index, row in enumerate(rows)
        if row["type"] == "session.status_idle" and row["stop_reason"]["type"] == "end_turn"
    )
    assert positions["agent.thread_message_received"] < done < idle
    assert not any(row["type"] == "agent.tool_use" and row.get("thread_id") for row in rows)
    assert sum(1 for row in rows if row["type"] == "session.status_running") == 1
    primary = factory.llm_for(session_id, None)
    assert primary is not None and len(primary.calls) == 3
    user_messages = [item for item in primary.calls[2]["messages"] if item.get("role") == "user"]
    report = str(user_messages[-1]["content"])
    assert report.startswith("[report from member")
    assert "wrote it" in report
    assert record["status"] == "idle"


async def test_reuse_latest_thread_and_new_thread(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("b", [tool_call("send_to_agent", {"agent": "B", "message": "hello"}, "b1")]),
                ScriptStep("s1", [tool_call("send_to_agent", {"agent": "self", "message": "one"}, "s1")]),
                ScriptStep("s2", [tool_call("send_to_agent", {"agent": "self", "message": "two"}, "s2")]),
                ScriptStep(
                    "s3",
                    [tool_call("send_to_agent", {"agent": "self", "message": "three", "new_thread": True}, "s3")],
                ),
                ScriptStep("paused"),
                ScriptStep("done"),
            ],
            "self": [ScriptStep("ok")],
            "agent:B": [ScriptStep("ok")],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
        results = [
            json.loads(tool_result_text(row))
            for row in rows
            if row["type"] == "agent.tool_result" and "delivered" in tool_result_text(row)
        ]
        assert len(results) >= 4
        assert results[1]["thread_id"] == results[2]["thread_id"]
        assert results[3]["thread_id"] != results[1]["thread_id"]
        b_tid = results[0]["thread_id"]
        primary = factory.llm_for(session_id, None)
        assert primary is not None
        primary._steps.append(
            ScriptStep(
                "bad",
                [tool_call("send_to_agent", {"agent": "self", "message": "no", "thread_id": b_tid}, "bad")],
            )
        )
        primary._steps.append(ScriptStep("after"))
        assert (await post_event(client, session_id, user_message("again"))).status_code == 200
        await wait_idle(client, session_id)
        later = await events_of(client, session_id)
    texts = [tool_result_text(row) for row in later if row["type"] == "agent.tool_result"]
    assert any(text == f'ERROR: thread {b_tid} does not belong to agent "self"' for text in texts)


async def test_thread_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("agenticx.managed.host.threads.MAX_ACTIVE_THREADS", 2)
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("one", [tool_call("send_to_agent", {"agent": "self", "message": "one"}, "s1")]),
                ScriptStep(
                    "two",
                    [tool_call("send_to_agent", {"agent": "self", "message": "two", "new_thread": True}, "s2")],
                ),
                ScriptStep("done"),
            ],
            "self": [ScriptStep("ok")],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
    texts = [tool_result_text(row) for row in rows if row["type"] == "agent.tool_result"]
    assert any(text.startswith("ERROR: thread limit reached") for text in texts)
    assert any("25 active threads" in text for text in texts)


async def test_disabled_member_unavailable(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("list", [tool_call("list_agents", {}, "l1")]),
                ScriptStep("send", [tool_call("send_to_agent", {"agent": "B", "message": "hi"}, "s1")]),
                ScriptStep("done"),
            ]
        }
    )
    config = host_config(tmp_path, coordinator_agents(member_status="disabled"))
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
    listed = json.loads(next(tool_result_text(row) for row in rows if "advisor_available" in tool_result_text(row)))
    member = next(item for item in listed["agents"] if item["agent"] == "B")
    assert member["available"] is False
    assert member["unavailable_reason"] == "agent is disabled"
    texts = [tool_result_text(row) for row in rows if row["type"] == "agent.tool_result"]
    assert 'ERROR: agent "B" is not available (agent is disabled)' in texts


async def test_member_ask_tool_denied_and_custom_hidden(tmp_path: Path) -> None:
    member = _manifest(
        tools=[
            {
                "type": "agx_builtin",
                "configs": [{"name": "bash_exec", "policy": "always_ask"}],
            },
            {
                "type": "custom",
                "name": "lookup",
                "description": "lookup a record",
                "input_schema": {"type": "object", "properties": {}},
            },
        ]
    )
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "B", "message": "run"}, "s1")]),
                ScriptStep("done"),
            ],
            "agent:B": [
                ScriptStep("run", [tool_call("bash_exec", {"command": "echo hi"}, "b1")]),
                ScriptStep("after"),
            ],
        }
    )
    config = host_config(tmp_path, coordinator_agents(member_manifest=member))
    async with hosted(config, factory) as (app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        tid = next(
            row["thread_id"]
            for row in await events_of(client, session_id)
            if row["type"] == "session.thread_created"
        )
        member_events = (
            await client.get(f"/ma/v1/sessions/{session_id}/threads/{tid}/events", params={"limit": 500})
        ).json()["data"]
        record = (await client.get(f"/ma/v1/sessions/{session_id}")).json()
    llm = factory.llm_for(session_id, tid)
    assert llm is not None
    assert "lookup" not in llm.calls[0]["tools"]
    denied = [
        row
        for row in member_events
        if row["type"] == "agent.tool_result" and row.get("is_error") is True
    ]
    assert denied
    assert "requires approval, which member threads do not support" in tool_result_text(denied[0])
    assert record["status"] != "requires_action"
    assert (record.get("stop_reason") or {}).get("type") != "requires_action"
    assert app is not None


async def test_self_copy_has_no_delegation_tools(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "self", "message": "hi"}, "s1")]),
                ScriptStep("done"),
            ],
            "self": [ScriptStep("ok")],
        }
    )
    config = host_config(tmp_path, coordinator_agents(advisor=True))
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        tid = next(
            row["thread_id"]
            for row in await events_of(client, session_id)
            if row["type"] == "session.thread_created" and row["agent"]["type"] == "self"
        )
    llm = factory.llm_for(session_id, tid)
    assert llm is not None
    names = set(llm.calls[0]["tools"])
    assert names.isdisjoint({"list_agents", "send_to_agent", "advisor", "task_list"})


async def test_advisor_one_shot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("agenticx.managed.host.threads.MAX_ACTIVE_THREADS", 2)
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("ask", [tool_call("advisor", {"question": "risks?"}, "a1")]),
                ScriptStep("send", [tool_call("send_to_agent", {"agent": "self", "message": "go"}, "s1")]),
                ScriptStep("list", [tool_call("list_agents", {}, "l1")]),
                ScriptStep("done"),
            ],
            "advisor": [ScriptStep("check inputs")],
            "self": [ScriptStep("ok")],
        }
    )
    config = host_config(tmp_path, coordinator_agents(advisor=True))
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
    advice = next(tool_result_text(row) for row in rows if tool_result_text(row) == "check inputs")
    assert advice == "check inputs"
    created = next(row for row in rows if row["type"] == "session.thread_created" and row["agent"]["type"] == "advisor")
    terminated = next(
        row
        for row in rows
        if row["type"] == "session.thread_status_terminated" and row.get("thread_id") == created["thread_id"]
    )
    assert terminated["reason"] == "completed"
    received = next(row for row in rows if row["type"] == "agent.thread_message_received" and row["from_agent_name"] == "advisor")
    assert received["from_thread_id"] == created["thread_id"]
    listed = json.loads(next(tool_result_text(row) for row in rows if "advisor_available" in tool_result_text(row)))
    assert all(item["type"] != "advisor" for item in listed["agents"])
    assert any(json.loads(tool_result_text(row)).get("delivered") is True for row in rows if tool_result_text(row).startswith("{"))


async def test_interrupt_member_thread_only(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "B", "message": "sleep"}, "s1")]),
                ScriptStep("waiting"),
                ScriptStep("resumed"),
            ],
            "agent:B": [
                ScriptStep("sleep", [tool_call("bash_exec", {"command": "sleep 30"}, "b1")]),
                ScriptStep("after"),
            ],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        tid = ""
        deadline = asyncio.get_running_loop().time() + 5
        while asyncio.get_running_loop().time() < deadline and not tid:
            for row in await events_of(client, session_id):
                if row["type"] == "session.thread_status_running":
                    tid = row["thread_id"]
            await asyncio.sleep(0.05)
        assert tid
        interrupted = await post_event(client, session_id, {"type": "user.interrupt", "thread_id": tid})
        assert interrupted.status_code == 200, interrupted.text
        await wait_idle(client, session_id, timeout=8)
        rows = await events_of(client, session_id)
    idles = [row for row in rows if row["type"] == "session.status_idle"]
    assert len(idles) == 1
    assert idles[0]["stop_reason"]["type"] == "end_turn"
    assert any(
        row["type"] == "agent.thread_message_received" and "[member thread interrupted by user]" in message_text(row)
        for row in rows
    )


async def test_interrupt_all_stops_members_no_report(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "B", "message": "sleep"}, "s1")]),
                ScriptStep("waiting"),
                ScriptStep("should-not-run"),
            ],
            "agent:B": [ScriptStep("sleep", [tool_call("bash_exec", {"command": "sleep 30"}, "b1")])],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        deadline = asyncio.get_running_loop().time() + 5
        seen = False
        while asyncio.get_running_loop().time() < deadline and not seen:
            seen = any(row["type"] == "session.thread_status_running" for row in await events_of(client, session_id))
            await asyncio.sleep(0.05)
        assert seen
        assert (await post_event(client, session_id, {"type": "user.interrupt"})).status_code == 200
        await wait_idle(client, session_id, timeout=8)
        before = await events_of(client, session_id)
        await asyncio.sleep(1)
        after = await events_of(client, session_id)
    assert any(row["type"] == "session.status_idle" and row["stop_reason"]["type"] == "end_turn" for row in before)
    assert sum(1 for row in after if row["type"] == "agent.thread_message_received") == sum(
        1 for row in before if row["type"] == "agent.thread_message_received"
    )
    assert sum(1 for row in after if row["type"] == "session.status_running") == sum(
        1 for row in before if row["type"] == "session.status_running"
    )


async def test_thread_targeting_validation(tmp_path: Path) -> None:
    factory = ThreadScriptFactory({"primary": [ScriptStep("done")]})
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        targeted = await post_event(client, session_id, user_message("hi", thread_id="T"))
        assert targeted.status_code == 400
        body = targeted.json()["error"]
        assert body["code"] == "invalid_event_batch"
        assert body["message"] == "events[0]: only user.interrupt may target a thread"
        assert await events_of(client, session_id) == []
        unknown = await post_event(client, session_id, {"type": "user.interrupt", "thread_id": "missing-thread"})
        assert unknown.status_code == 400
        assert unknown.json()["error"]["message"] == "events[0]: unknown thread"
        itself = await post_event(client, session_id, {"type": "user.interrupt", "thread_id": session_id})
        assert itself.status_code == 400
        assert itself.json()["error"]["message"] == "events[0]: unknown thread"
        assert await events_of(client, session_id) == []


async def test_create_session_rejections(tmp_path: Path) -> None:
    agents = coordinator_agents()
    disabled = host_config(tmp_path / "off", agents, threads=False)
    async with hosted(disabled, ThreadScriptFactory({"primary": [ScriptStep("done")]})) as (_app, client):
        rejected = await client.post("/ma/v1/sessions", json={"agent_id": "C"})
        assert rejected.status_code == 400
        assert rejected.json()["error"]["message"] == "multiagent is not enabled on this host"
        plain = _definition("plain", "Plain", _manifest())
        disabled.agents = {**disabled.agents, "plain": plain}
        created = await client.post("/ma/v1/sessions", json={"agent_id": "plain"})
        assert created.status_code == 201, created.text

    desktop = host_config(tmp_path / "desk", agents, threads=True)
    async with hosted(desktop, ThreadScriptFactory({"primary": [ScriptStep("done")]})) as (_app, client):
        rejected = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "C", "environment_id": "worker"},
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["message"] == "multiagent agents require a cloud environment"

    vaulted = host_config(tmp_path / "vault", agents, threads=True)
    async with hosted(vaulted, ThreadScriptFactory({"primary": [ScriptStep("done")]})) as (_app, client):
        rejected = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "C", "vault_ids": ["vault-1"]},
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["message"] == "multiagent sessions do not support vault_ids or resources yet"


async def test_session_usage_includes_members(tmp_path: Path) -> None:
    factory = _UsageFactory(
        {
            "primary": [
                ScriptStep(
                    "sending",
                    [tool_call("send_to_agent", {"agent": "B", "message": "write"}, "c1")],
                ),
                ScriptStep("waiting"),
                ScriptStep("all done"),
            ],
            "agent:B": [
                ScriptStep("writing", [tool_call("file_write", {"path": "out/b.txt", "content": "hi"}, "b1")]),
                ScriptStep("wrote it"),
            ],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        record = (await client.get(f"/ma/v1/sessions/{session_id}")).json()
        rows = await events_of(client, session_id)
        tid = next(row["thread_id"] for row in rows if row["type"] == "session.thread_created")
        member_rows = (
            await client.get(f"/ma/v1/sessions/{session_id}/threads/{tid}/events", params={"limit": 500})
        ).json()["data"]
    primary_usage = [row for row in rows if row["type"] == "session.usage" and not row.get("thread_id")]
    assert primary_usage[-1]["usage"]["input_tokens"] == record["usage"]["input_tokens"] == 44
    assert primary_usage[-1]["usage"]["output_tokens"] == record["usage"]["output_tokens"] == 21
    member_usage = [row for row in member_rows if row["type"] == "session.usage"]
    assert member_usage[-1]["thread_id"] == tid
    assert member_usage[-1]["usage"]["input_tokens"] == 14
    assert member_usage[-1]["usage"]["output_tokens"] == 6


async def test_load_marks_member_threads_context_lost(tmp_path: Path) -> None:
    factory = ThreadScriptFactory({"primary": [ScriptStep("ok")]})
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (app, client):
        session_id = await create_session(client)
        tid = new_ulid()
        await app.state.ma.event_log.append(
            "dev",
            session_id,
            [
                {
                    "id": new_ulid(),
                    "type": "session.thread_created",
                    "thread_id": tid,
                    "agent": {"type": "agent", "agent_id": "B", "agent_version": 1, "name": "Member B"},
                }
            ],
        )
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        rows = await events_of(client, session_id)
    lost = [
        row
        for row in rows
        if row["type"] == "session.thread_status_terminated" and row.get("reason") == "context_lost"
    ]
    assert lost and lost[0]["thread_id"] == tid


async def test_member_effect_guard_key_isolated(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "self", "message": "hi"}, "s1")]),
                ScriptStep("done"),
            ],
            "self": [ScriptStep("ok")],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        actor = app.state.ma.service._actors[("dev", session_id)]
        state = next(item for item in actor.threads._states.values() if item.member_key == "self")
        bundle = state.runner.bundle
        assert bundle.session.session_id == session_id
        assert bundle.session._session_id == f"{session_id}.{state.thread_id}"
        assert resolve_session_id(bundle.session) == f"{session_id}.{state.thread_id}"
