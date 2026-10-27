#!/usr/bin/env python3
"""Background bash tasks, platform tools, and the running-session wake loop.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.continuation import TurnContinuation
from agenticx.managed.host.platform_tools import PlatformToolResolver
from agenticx.managed.host.tasks import SessionTaskManager
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, StaticLLMFactory, tool_call
from agenticx.tools.fallback_chain import ToolResolver
from tests.managed.conftest import make_config

_TASK_ID_RE = re.compile(r"^task_id=([0-9A-HJKMNP-TV-Z]{26})$", re.MULTILINE)


class _Delegate(ToolResolver):
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent == "custom_tool"

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        self.calls.append((task_intent, kwargs))
        return "delegated"


class _Store:
    def __init__(self) -> None:
        self.rows: list[StoredEvent] = []

    async def list_events(self, tenant_id: str, session_id: str, *, after_seq: int = 0, limit: int = 100, types: list[str] | None = None):
        del tenant_id, session_id
        rows = [
            row
            for row in self.rows
            if row.seq > after_seq and (not types or row.type in types)
        ]
        return rows[:limit]


class _Actor:
    def __init__(self, store: _Store) -> None:
        self.adapter = SimpleNamespace(ledger=SimpleNamespace(latest_bound_event_id=lambda name: "evt-bash" if name == "bash_exec" else None))
        self.tenant_id = "dev"
        self.session_id = "sess-tasks"
        self.service = SimpleNamespace(store=store)
        self._seq = 0

    async def append(self, events: list[dict[str, Any]]) -> list[StoredEvent]:
        stored: list[StoredEvent] = []
        for event in events:
            self._seq += 1
            payload = {
                key: value
                for key, value in event.items()
                if key not in {"id", "session_id", "seq", "thread_id", "type", "created_at", "processed_at"}
            }
            item = StoredEvent(
                id=str(event.get("id") or new_ulid()),
                tenant_id=self.tenant_id,
                session_id=self.session_id,
                seq=self._seq,
                type=str(event["type"]),
                payload=payload,
                created_at=utc_now_iso(),
            )
            self.service.store.rows.append(item)
            stored.append(item)
        return stored


def _session(tmp_path: Path) -> StudioSession:
    session = StudioSession()
    session.workspace_dir = str(tmp_path)
    session.session_id = "sess-tasks"
    session.taskspaces = [{"id": "default", "label": "workspace", "path": str(tmp_path)}]
    return session


def _manager(
    tmp_path: Path,
    *,
    foreground: float = 60.0,
    max_runtime: float = 3600.0,
    max_running: int = 8,
) -> tuple[SessionTaskManager, StudioSession, _Store, PlatformToolResolver]:
    store = _Store()
    actor = _Actor(store)
    continuation = TurnContinuation()
    manager = SessionTaskManager(
        actor=actor,
        continuation=continuation,
        foreground_seconds=foreground,
        max_runtime_seconds=max_runtime,
        max_running=max_running,
    )
    session = _session(tmp_path)
    tools = [
        {
            "type": "function",
            "function": {
                "name": "bash_exec",
                "description": "Run a command.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]
    bundle = SimpleNamespace(session=session, tools=tools, workdir=tmp_path)
    resolver = PlatformToolResolver(None)
    manager.install(bundle, resolver)
    return manager, session, store, resolver


class _AllowGate:
    """Unit-test gate: background bash must run sleep, which unattended mode rejects."""

    last_denial_note = ""

    async def request_confirm(self, question: str, context: dict[str, Any] | None = None) -> bool:
        del question, context
        return True

    def should_emit_prompt(self, context: dict[str, Any] | None = None) -> bool:
        del context
        return False

    def is_service_mode(self) -> bool:
        return True

    def resolve(self, request_id: str, approved: bool) -> bool:
        del request_id, approved
        return False


def _gate() -> _AllowGate:
    return _AllowGate()


async def _wait_event(store: _Store, event_type: str, timeout: float = 5) -> StoredEvent:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = [row for row in store.rows if row.type == event_type]
        if found:
            return found[-1]
        await asyncio.sleep(0.05)
    raise AssertionError([row.type for row in store.rows])


async def test_platform_resolver_prefers_platform_then_delegate() -> None:
    delegate = _Delegate()
    resolver = PlatformToolResolver(delegate)
    seen: dict[str, Any] = {}

    async def handler(arguments: dict[str, Any], tool_call_id: str | None) -> str:
        if arguments.get("boom"):
            raise RuntimeError("secret")
        seen["args"] = arguments
        seen["id"] = tool_call_id
        return "ok"

    resolver.register("task_list", {"type": "function", "function": {"name": "task_list"}}, handler)
    assert await resolver.resolve("task_list", __tool_call_id="c1", state="all") == "ok"
    assert seen["args"] == {"state": "all"}
    assert seen["id"] == "c1"
    assert "__tool_call_id" not in seen["args"]
    assert await resolver.resolve("custom_tool", x=1) == "delegated"
    assert delegate.calls == [("custom_tool", {"x": 1})]
    failed = await resolver.resolve("task_list", boom=True)
    assert failed == "ERROR: tool task_list failed"
    assert "secret" not in failed


async def test_short_command_returns_inline(tmp_path: Path) -> None:
    manager, session, store, _resolver = _manager(tmp_path, foreground=2)
    try:
        result = await manager.run_bash(
            {"command": "echo hi"},
            session,
            confirm_gate=_gate(),
        )
    finally:
        await manager.close()
    assert result.startswith("exit_code=0\nstdout:\nhi")
    assert [row.type for row in store.rows if row.type.startswith("session.task_")] == []


async def test_long_command_moves_to_background(tmp_path: Path) -> None:
    manager, session, store, _resolver = _manager(tmp_path, foreground=0.5)
    try:
        result = await manager.run_bash(
            {"command": "sleep 2; echo done"},
            session,
            confirm_gate=_gate(),
        )
        match = _TASK_ID_RE.search(result)
        assert match is not None
        assert "status=running" in result
        created = await _wait_event(store, "session.task_created")
        assert created.payload["tool"]["name"] == "bash_exec"
        assert str(created.payload["summary"]).startswith("sleep 2")
        log_path = str(created.payload["log_path"])
        assert log_path.startswith(".ma/tasks/")
        assert (tmp_path / log_path).is_file()
        completed = await _wait_event(store, "session.task_completed", timeout=5)
        assert completed.payload["state"] == "succeeded"
        assert completed.payload["result"]["exit_code"] == 0
        assert "done" in completed.payload["result"]["output"]
    finally:
        await manager.close()


async def test_run_in_background_true_returns_immediately(tmp_path: Path) -> None:
    manager, session, _store, _resolver = _manager(tmp_path, foreground=5)
    started = time.monotonic()
    try:
        result = await manager.run_bash(
            {"command": "sleep 1", "run_in_background": True},
            session,
            confirm_gate=_gate(),
        )
    finally:
        await manager.close()
    assert time.monotonic() - started < 0.5
    assert _TASK_ID_RE.search(result)


async def test_explicit_short_timeout_kills(tmp_path: Path) -> None:
    manager, session, store, _resolver = _manager(tmp_path, foreground=5)
    try:
        result = await manager.run_bash(
            {"command": "sleep 3", "timeout_sec": 1},
            session,
            confirm_gate=_gate(),
        )
    finally:
        await manager.close()
    assert result == "ERROR: command timeout after 1s"
    assert store.rows == []


async def test_running_task_limit(tmp_path: Path) -> None:
    manager, session, _store, _resolver = _manager(tmp_path, foreground=0.3, max_running=1)
    try:
        first = await manager.run_bash(
            {"command": "sleep 3"},
            session,
            confirm_gate=_gate(),
        )
        assert _TASK_ID_RE.search(first)
        second = await manager.run_bash(
            {"command": "sleep 3"},
            session,
            confirm_gate=_gate(),
        )
    finally:
        await manager.close()
    assert second == "ERROR: too many background tasks (max 1); stop one with task_kill first"


async def test_background_task_timeout_fails(tmp_path: Path) -> None:
    manager, session, store, _resolver = _manager(tmp_path, foreground=0.2, max_runtime=0.6)
    try:
        result = await manager.run_bash(
            {"command": "sleep 5"},
            session,
            confirm_gate=_gate(),
        )
        assert _TASK_ID_RE.search(result)
        completed = await _wait_event(store, "session.task_completed", timeout=4)
        assert completed.payload["state"] == "failed"
        assert completed.payload["error"]["type"] == "timeout"
    finally:
        await manager.close()


async def test_task_tools_list_get_kill(tmp_path: Path, monkeypatch) -> None:
    async def _passthrough(argv, session, cwd, **_kwargs):
        del session, cwd
        return list(argv), None, "none"

    monkeypatch.setattr(agent_tools, "_apply_command_sandbox", _passthrough)
    manager, session, store, resolver = _manager(tmp_path, foreground=5)
    try:
        started = await manager.run_bash(
            {
                "command": "python3 -u -c 'print(\"hello\"); import time; time.sleep(30)'",
                "run_in_background": True,
            },
            session,
            confirm_gate=_gate(),
        )
        task_id = _TASK_ID_RE.search(started).group(1)  # type: ignore[union-attr]
        deadline = time.monotonic() + 2
        listed = ""
        output = ""
        while time.monotonic() < deadline:
            listed = await resolver.resolve("task_list", state="running")
            got_now = json.loads(await resolver.resolve("task_get", task_id=task_id))
            output = str((got_now.get("result") or {}).get("output") or "")
            if task_id in listed and "hello" in output:
                break
            await asyncio.sleep(0.05)
        payload = json.loads(listed)
        match = next(item for item in payload["tasks"] if item["task_id"] == task_id)
        assert match["state"] == "running"
        got = json.loads(await resolver.resolve("task_get", task_id=task_id))
        assert "hello" in got["result"]["output"]
        killed = json.loads(await resolver.resolve("task_kill", task_id=task_id))
        assert killed["state"] == "cancelled"
        assert manager.continuation._queue == []
        completed = await _wait_event(store, "session.task_completed")
        assert completed.payload["error"]["type"] == "killed_by_agent"
        assert not manager.continuation.has_pending
    finally:
        await manager.close()


async def test_task_events_do_not_contain_env(monkeypatch, tmp_path: Path) -> None:
    real = agent_tools._bash_exec_prepare

    async def wrapped(*args, **kwargs):
        prepared = await real(*args, **kwargs)
        if isinstance(prepared, str):
            return prepared
        env = dict(prepared.env or os.environ)
        env["AGX_SECRET_PROBE"] = "s3cr3t-xyz"
        return replace(prepared, env=env)

    monkeypatch.setattr("agenticx.managed.host.tasks._bash_exec_prepare", wrapped)
    manager, session, store, _resolver = _manager(tmp_path, foreground=5)
    try:
        result = await manager.run_bash(
            {"command": "echo hi", "run_in_background": True},
            session,
            confirm_gate=_gate(),
        )
        assert "s3cr3t-xyz" not in result
        if _TASK_ID_RE.search(result):
            await _wait_event(store, "session.task_completed", timeout=4)
        blob = json.dumps([row.to_wire() for row in store.rows], ensure_ascii=False)
        assert "s3cr3t-xyz" not in blob
        for path in tmp_path.rglob("*.log"):
            assert "s3cr3t-xyz" not in path.read_text(encoding="utf-8")
    finally:
        await manager.close()


def _manifest(max_rounds: int = 8) -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "test",
        "tools": [{"type": "agx_builtin", "default_policy": "always_allow"}],
        "runtime": {"max_tool_rounds": max_rounds},
    }


def _message_text(event: dict[str, Any]) -> str:
    parts: list[str] = []
    for block in event.get("content") or []:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts)


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    found = ""
    for message in messages:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            found = content
        elif isinstance(content, list):
            found = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict)
            )
    return found


async def _events(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _wait_idle(client: httpx.AsyncClient, session_id: str, stop_type: str, timeout: float = 8) -> None:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        reason = last.get("stop_reason") or {}
        if last.get("status") == "idle" and reason.get("type") == stop_type:
            return
        await asyncio.sleep(0.05)
    rows = await _events(client, session_id)
    raise AssertionError(
        {
            "status": last.get("status"),
            "stop": (last.get("stop_reason") or {}).get("type"),
            "events": [row["type"] for row in rows],
        }
    )


async def _post(client: httpx.AsyncClient, session_id: str, event: dict[str, Any]) -> None:
    posted = await client.post(f"/ma/v1/sessions/{session_id}/events", json={"events": [event]})
    assert posted.status_code == 200, posted.text


def _app(tmp_path: Path, factory: Any, *, rounds: int = 8, foreground: float = 0.3, enabled: bool = True):
    config = make_config(tmp_path, manifest=_manifest(rounds))
    config.tasks_enabled = enabled
    config.task_foreground_seconds = foreground
    return create_ma_app(config, llm_factory=factory), config


async def test_session_stays_running_until_task_done(tmp_path: Path) -> None:
    factory = PerSessionScriptFactory(
        [
            ScriptStep("checking", [tool_call("bash_exec", {"command": "sleep 1; echo ok"}, "c1")]),
            ScriptStep("waiting"),
            ScriptStep("task finished"),
        ]
    )
    app, _config = _app(tmp_path, factory, foreground=0.3)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            assert created.status_code == 201, created.text
            session_id = created.json()["id"]
            await _post(
                client,
                session_id,
                {"type": "user.message", "content": [{"type": "text", "text": "go"}]},
            )
            await _wait_idle(client, session_id, "end_turn", timeout=8)
            events = await _events(client, session_id)
    finally:
        await app.state.ma.shutdown()
    types = [row["type"] for row in events]
    assert types.count("session.status_running") == 1
    created_at = types.index("session.task_created")
    waiting = next(
        index
        for index, row in enumerate(events)
        if row["type"] == "agent.message" and _message_text(row) == "waiting"
    )
    usage = next(index for index, row in enumerate(events) if index > waiting and row["type"] == "session.usage")
    completed = next(index for index, row in enumerate(events) if row["type"] == "session.task_completed")
    finished = next(
        index
        for index, row in enumerate(events)
        if row["type"] == "agent.message" and _message_text(row) == "task finished"
    )
    idle = next(
        index
        for index, row in enumerate(events)
        if row["type"] == "session.status_idle" and row["stop_reason"]["type"] == "end_turn"
    )
    assert created_at < waiting < usage < completed < finished < idle
    assert not any(row["type"] == "session.status_idle" for row in events[usage:completed])
    llm = factory.by_session[session_id]
    assert len(llm.calls) == 3
    assert _last_user_text(llm.calls[2]["messages"]).startswith("[background task notification]")


async def test_interrupt_cancels_tasks_and_no_wake(tmp_path: Path) -> None:
    factory = PerSessionScriptFactory(
        [
            ScriptStep("checking", [tool_call("bash_exec", {"command": "sleep 30"}, "c1")]),
            ScriptStep("waiting"),
        ]
    )
    app, _config = _app(tmp_path, factory, foreground=0.3)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            session_id = created.json()["id"]
            await _post(
                client,
                session_id,
                {"type": "user.message", "content": [{"type": "text", "text": "go"}]},
            )
            deadline = time.monotonic() + 5
            task_id = ""
            while time.monotonic() < deadline and not task_id:
                for row in await _events(client, session_id):
                    if row["type"] == "session.task_created":
                        task_id = row["task_id"]
                await asyncio.sleep(0.05)
            assert task_id
            actor = app.state.ma.service._actors[("dev", session_id)]
            proc = actor.executor.tasks._procs[task_id].process
            await _post(client, session_id, {"type": "user.interrupt"})
            await _wait_idle(client, session_id, "end_turn", timeout=6)
            events = await _events(client, session_id)
            running_count = sum(1 for row in events if row["type"] == "session.status_running")
            await asyncio.sleep(1)
            later = await _events(client, session_id)
            assert sum(1 for row in later if row["type"] == "session.status_running") == running_count
            assert proc.returncode is not None
    finally:
        await app.state.ma.shutdown()
    cancelled = [
        row
        for row in events
        if row["type"] == "session.task_completed" and row["state"] == "cancelled"
    ]
    assert cancelled
    assert cancelled[0]["error"]["type"] == "interrupted"
    idle = next(row for row in events if row["type"] == "session.status_idle")
    assert idle["stop_reason"]["type"] == "end_turn"


async def test_max_tool_rounds_cancels_tasks(tmp_path: Path) -> None:
    factory = PerSessionScriptFactory(
        [ScriptStep("checking", [tool_call("bash_exec", {"command": "sleep 5"}, "c1")])]
    )
    app, _config = _app(tmp_path, factory, rounds=1, foreground=0.2)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            session_id = created.json()["id"]
            await _post(
                client,
                session_id,
                {"type": "user.message", "content": [{"type": "text", "text": "go"}]},
            )
            await _wait_idle(client, session_id, "max_tool_rounds", timeout=6)
            events = await _events(client, session_id)
    finally:
        await app.state.ma.shutdown()
    stopped = next(
        index
        for index, row in enumerate(events)
        if row["type"] == "session.task_completed" and row.get("error", {}).get("type") == "session_stopped"
    )
    idle = next(
        index
        for index, row in enumerate(events)
        if row["type"] == "session.status_idle" and row["stop_reason"]["type"] == "max_tool_rounds"
    )
    assert stopped < idle


async def test_disabled_has_no_task_tools(tmp_path: Path) -> None:
    factory = PerSessionScriptFactory([ScriptStep("hi")])
    app, _config = _app(tmp_path, factory, enabled=False)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            session_id = created.json()["id"]
            await _post(
                client,
                session_id,
                {"type": "user.message", "content": [{"type": "text", "text": "go"}]},
            )
            await _wait_idle(client, session_id, "end_turn")
            actor = app.state.ma.service._actors[("dev", session_id)]
            bundle_session = actor.executor._bundle.session
    finally:
        await app.state.ma.shutdown()
    llm = factory.by_session[session_id]
    assert "task_list" not in llm.calls[0]["tools"]
    assert not hasattr(bundle_session, "managed_tool_overrides")


class _TaskToolLLM:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.task_id = ""

    def invoke(self, messages: Any, **kwargs: Any) -> Any:
        tools = kwargs.get("tools") or []
        names = [tool["function"]["name"] for tool in tools] if isinstance(tools, list) else []
        blob = json.dumps(messages, ensure_ascii=False, default=str)
        match = re.search(r"task_id=([0-9A-HJKMNP-TV-Z]{26})", blob)
        if match:
            self.task_id = match.group(1)
        phase = len(self.calls)
        self.calls.append({"messages": [dict(item) for item in messages], "tools": names})
        if phase == 0:
            return _Resp(
                "",
                [
                    tool_call(
                        "bash_exec",
                        {
                            "command": "python3 -u -c 'print(\"hello\"); import time; time.sleep(30)'",
                            "run_in_background": True,
                        },
                        "c1",
                    )
                ],
            )
        if phase == 1:
            return _Resp("", [tool_call("task_list", {}, "c2")])
        if phase == 2:
            return _Resp("", [tool_call("task_get", {"task_id": self.task_id}, "c3")])
        if phase == 3:
            return _Resp("", [tool_call("task_kill", {"task_id": self.task_id}, "c4")])
        return _Resp("stopped", [])

    def stream(self, *args: Any, **kwargs: Any):
        del args, kwargs
        return iter(())


class _Resp:
    def __init__(self, content: str, tool_calls: list[dict[str, Any]]) -> None:
        self.content = content
        self.tool_calls = tool_calls


async def test_task_tools_drive_no_extra_llm_call(tmp_path: Path) -> None:
    llm = _TaskToolLLM()
    app, _config = _app(tmp_path, StaticLLMFactory(llm), foreground=0.3)
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            session_id = created.json()["id"]
            await _post(
                client,
                session_id,
                {"type": "user.message", "content": [{"type": "text", "text": "go"}]},
            )
            await _wait_idle(client, session_id, "end_turn", timeout=8)
            events = await _events(client, session_id)
    finally:
        await app.state.ma.shutdown()
    assert "task_list" in llm.calls[0]["tools"]
    assert len(llm.calls) == 5
    assert not any(
        _last_user_text(call["messages"]).startswith("[background task notification]")
        for call in llm.calls
    )
    completed = [row for row in events if row["type"] == "session.task_completed"]
    assert completed[-1]["state"] == "cancelled"
    assert completed[-1]["error"]["type"] == "killed_by_agent"
