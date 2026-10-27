#!/usr/bin/env python3
"""Session resources, read-only mounts, conflicts, and mount failure.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import Principal
from agenticx.managed.memory import InMemoryMemoryStoreClient, MemoryServiceError
from agenticx.managed.memory_mount import install_memory_mounts
from agenticx.managed.testing import (
    PerSessionScriptFactory,
    ScriptStep,
    ScriptedLLM,
    tool_call,
)
from tests.managed.conftest import make_config

_MANIFEST = {
    "schema": "agx.agent/v1",
    "model": "fake/scripted",
    "system": "Use the tools, then answer.",
    "tools": [{"type": "agx_builtin", "default_policy": "always_allow"}],
    "runtime": {"max_tool_rounds": 8},
}
_STORE_A = "01JSTOREAAAAAAAAAAAAAAAAAA"
_STORE_B = "01JSTOREBBBBBBBBBBBBBBBBBB"
_ARCHIVED = "ARCHIVEDSTORE000000000001"


class _NoopExecutor:
    async def submit_message(self, message: Any) -> None:
        del message

    async def on_resolved(self, resolutions: Any) -> None:
        del resolutions

    async def interrupt(self, dropped_pending: Any) -> None:
        del dropped_pending

    async def close(self) -> None:
        return None


class _BoomSnapshot(InMemoryMemoryStoreClient):
    async def snapshot(self, tenant_id: str, session_id: str, store_id: str):
        del tenant_id, session_id, store_id
        raise MemoryServiceError("down", status=503, transient=True)


class _EditingLLM(ScriptedLLM):
    def __init__(self, steps: list[ScriptStep], edit) -> None:
        super().__init__(steps)
        self._edit = edit

    def invoke(self, messages: Any, **kwargs: Any):
        response = super().invoke(messages, **kwargs)
        if self._index == 2:
            self._edit()
        return response


class _EditingFactory:
    def __init__(self, steps: list[ScriptStep], edit) -> None:
        self._steps = steps
        self._edit = edit
        self.by_session: dict[str, _EditingLLM] = {}

    def create(self, *, provider: str, model: str, context: Any) -> _EditingLLM:
        del provider, model
        existing = self.by_session.get(context.session_id)
        if existing is not None:
            return existing
        llm = _EditingLLM(self._steps, self._edit)
        self.by_session[context.session_id] = llm
        return llm


def _prepare(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tokens: dict[str, Principal] | None = None,
):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    config = make_config(tmp_path, manifest=_MANIFEST, tokens=tokens)
    config.data_dir = home / ".agenticx"
    config.data_dir.mkdir(parents=True, exist_ok=True)
    return home, config


def _error_types(rows: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for row in rows:
        if row.get("type") != "session.error":
            continue
        error = row.get("error") or {}
        if isinstance(error.get("type"), str):
            found.append(error["type"])
    return found


def _error_text(rows: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for row in rows:
        if row.get("type") != "session.error":
            continue
        error = row.get("error") or {}
        parts.append(str(error.get("message") or ""))
    return "\n".join(parts)


def _tool_result(rows: list[dict[str, Any]], name: str) -> dict[str, Any]:
    uses = {row["id"]: row for row in rows if row.get("type") == "agent.tool_use"}
    for row in rows:
        if row.get("type") != "agent.tool_result":
            continue
        use = uses.get(row.get("tool_use_id"))
        if use and use.get("name") == name:
            return row
    raise AssertionError(name)


def _text(row: dict[str, Any]) -> str:
    return "\n".join(
        block.get("text", "")
        for block in row.get("content") or []
        if isinstance(block, dict)
    )


async def _wait(
    client: httpx.AsyncClient, session_id: str, stop: str = "end_turn"
) -> None:
    deadline = time.monotonic() + 20
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        last = response.json()
        reason = last.get("stop_reason") or {}
        if last.get("status") == "idle" and reason.get("type") == stop:
            return
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events")
    raise AssertionError({"session": last, "events": events.text})


async def _events(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"/ma/v1/sessions/{session_id}/events", params={"limit": 200}
    )
    return response.json()["data"]


async def _post(client: httpx.AsyncClient, session_id: str, text: str = "go") -> None:
    posted = await client.post(
        f"/ma/v1/sessions/{session_id}/events",
        json={
            "events": [
                {"type": "user.message", "content": [{"type": "text", "text": text}]}
            ]
        },
    )
    assert posted.status_code == 200, posted.text


async def test_create_session_resources_validation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _home, config = _prepare(
        tmp_path,
        monkeypatch,
        tokens={
            "tok-full": Principal(
                "dev",
                "U1",
                frozenset(
                    {
                        "ma:sessions:read",
                        "ma:sessions:write",
                        "ma:memory:write",
                        "ma:memory:read",
                    }
                ),
            ),
            "tok-limited": Principal(
                "dev",
                "U2",
                frozenset({"ma:sessions:read", "ma:sessions:write"}),
            ),
        },
    )
    memory = InMemoryMemoryStoreClient()
    memory.add_store(_STORE_A, "项目知识")
    memory.add_store(_STORE_B, "Team Glossary")
    memory.add_store(_ARCHIVED, "Old", status="archived")
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    install_memory_mounts(app.state.ma, memory)
    app.state.ma.service.register_executor_factory(
        "desktop_worker", lambda _actor: _NoopExecutor()
    )
    await app.state.ma.startup()
    full = {"Authorization": "Bearer tok-full"}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post(
                "/ma/v1/sessions",
                headers=full,
                json={
                    "agent_id": "demo",
                    "resources": [
                        {
                            "type": "memory_store",
                            "memory_store_id": _STORE_A,
                            "instructions": "prefs",
                        },
                        {
                            "type": "memory_store",
                            "memory_store_id": _STORE_B,
                            "access": "read_only",
                        },
                    ],
                },
            )
            assert created.status_code == 201, created.text
            resources = created.json()["resources"]
            assert resources[0]["access"] == "read_write"
            assert resources[0]["mount_path"] == "memory/项目知识-aaaaaa"
            assert resources[1]["mount_path"] == "memory/team-glossary-bbbbbb"
            assert re.fullmatch(r"memory/.+-[0-9a-z]{6}", resources[0]["mount_path"])
            assert re.fullmatch(r"memory/.+-[0-9a-z]{6}", resources[1]["mount_path"])

            async def reject(
                body: dict[str, Any],
                status: int,
                message: str,
                headers: dict[str, str] | None = None,
            ):
                response = await client.post(
                    "/ma/v1/sessions",
                    headers=headers or full,
                    json=body,
                )
                assert response.status_code == status, response.text
                assert message in response.json()["error"]["message"]

            too_many = [
                {"type": "memory_store", "memory_store_id": _STORE_A} for _ in range(9)
            ]
            await reject({"agent_id": "demo", "resources": too_many}, 400, "at most 8")
            await reject(
                {
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _STORE_A, "foo": 1}
                    ],
                },
                400,
                "resources[0].foo: unknown field",
            )
            await reject(
                {
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _STORE_A},
                        {"type": "memory_store", "memory_store_id": _STORE_A},
                    ],
                },
                400,
                "must not mount the same memory store twice",
            )
            await reject(
                {
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": "missing-store"}
                    ],
                },
                400,
                "memory store not found",
            )
            await reject(
                {
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _ARCHIVED}
                    ],
                },
                400,
                "memory store is archived",
            )
            limited = await client.post(
                "/ma/v1/sessions",
                headers={"Authorization": "Bearer tok-limited"},
                json={
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _STORE_A}
                    ],
                },
            )
            assert limited.status_code == 403, limited.text
            assert limited.json()["error"]["code"] == "forbidden_scope"
            desktop = await client.post(
                "/ma/v1/sessions",
                headers=full,
                json={
                    "agent_id": "demo",
                    "environment_id": "worker",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _STORE_A}
                    ],
                },
            )
            assert desktop.status_code == 400, desktop.text
            assert desktop.json()["error"]["message"] == (
                "resources are not supported for desktop_worker environments"
            )
    finally:
        await app.state.ma.shutdown()

    bare = create_ma_app(
        make_config(tmp_path / "bare", manifest=_MANIFEST),
        llm_factory=PerSessionScriptFactory([ScriptStep("hi")]),
    )
    await bare.state.ma.startup()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=bare),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            response = await client.post(
                "/ma/v1/sessions",
                json={
                    "agent_id": "demo",
                    "resources": [
                        {"type": "memory_store", "memory_store_id": _STORE_A}
                    ],
                },
            )
            assert response.status_code == 400, response.text
            assert (
                response.json()["error"]["message"]
                == "resources are not supported by this host yet"
            )
    finally:
        await bare.state.ma.shutdown()


async def test_read_only_mount_blocks_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home, config = _prepare(tmp_path, monkeypatch)
    memory = InMemoryMemoryStoreClient()
    memory.add_store("S", "Notes")
    memory.put("S", "/x.md", "original")
    holder: dict[str, Path] = {}

    def edit() -> None:
        path = holder["path"]
        os.chmod(path, 0o644)
        path.write_text("hacked", encoding="utf-8")

    factory = _EditingFactory(
        [
            ScriptStep(
                "1",
                [tool_call("file_write", {"path": "pending", "content": "hack"}, "c1")],
            ),
            ScriptStep("done"),
            ScriptStep("next"),
        ],
        edit,
    )
    app = create_ma_app(config, llm_factory=factory)
    install_memory_mounts(app.state.ma, memory)
    await app.state.ma.startup()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post(
                "/ma/v1/sessions",
                json={
                    "agent_id": "demo",
                    "resources": [
                        {
                            "type": "memory_store",
                            "memory_store_id": "S",
                            "access": "read_only",
                        }
                    ],
                },
            )
            assert created.status_code == 201, created.text
            body = created.json()
            session_id = body["id"]
            mount_path = body["resources"][0]["mount_path"]
            memory.mount("dev", session_id, "S", "read_only")
            holder["path"] = (
                home
                / ".agenticx"
                / "sessions"
                / session_id
                / "work"
                / mount_path
                / "x.md"
            )
            factory.by_session.clear()
            llm_steps = factory._steps
            llm_steps[0] = ScriptStep(
                "1",
                [
                    tool_call(
                        "file_write",
                        {"path": f"{mount_path}/x.md", "content": "hack"},
                        "c1",
                    )
                ],
            )
            await _post(client, session_id)
            await _wait(client, session_id)
            rows = await _events(client, session_id)
            result = _tool_result(rows, "file_write")
            assert result["is_error"] is True
            assert _text(result).startswith(
                "ERROR: path is read-only (memory store mounted read_only)"
            )
            assert memory.get("S", "/x.md").content == "original"
            assert "memory_read_only_violation" in _error_types(rows)
            await _post(client, session_id, "again")
            await _wait(client, session_id)
            assert holder["path"].read_text(encoding="utf-8") == "original"
            assert memory.get("S", "/x.md").content == "original"
    finally:
        await app.state.ma.shutdown()


async def test_two_sessions_conflict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home, config = _prepare(tmp_path, monkeypatch)
    memory = InMemoryMemoryStoreClient()
    memory.add_store("S", "Notes")
    memory.put("S", "/a.md", "v1")
    scripts: dict[str, list[ScriptStep]] = {}
    roles: dict[str, str] = {}
    b_holding = threading.Event()
    a_done = threading.Event()

    class _GatedLLM(ScriptedLLM):
        def __init__(self, steps: list[ScriptStep], role: str) -> None:
            super().__init__(steps)
            self._role = role

        def invoke(self, messages: Any, **kwargs: Any):
            # Turn 2's first call still has the v1 baseline from before_turn.
            # Hold there until A has published v2, so this write is a real CAS conflict.
            if self._role == "B" and self._index == 1:
                b_holding.set()
                if not a_done.wait(timeout=20):
                    raise TimeoutError("session A did not finish its write")
            return super().invoke(messages, **kwargs)

    class _Factory:
        def __init__(self) -> None:
            self.by_session: dict[str, ScriptedLLM] = {}

        def create(self, *, provider: str, model: str, context: Any) -> ScriptedLLM:
            del provider, model
            existing = self.by_session.get(context.session_id)
            if existing is not None:
                return existing
            llm = _GatedLLM(
                scripts[context.session_id], roles.get(context.session_id, "")
            )
            self.by_session[context.session_id] = llm
            return llm

    app = create_ma_app(config, llm_factory=_Factory())
    install_memory_mounts(app.state.ma, memory)
    await app.state.ma.startup()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:

            async def open_session() -> tuple[str, str]:
                created = await client.post(
                    "/ma/v1/sessions",
                    json={
                        "agent_id": "demo",
                        "resources": [
                            {
                                "type": "memory_store",
                                "memory_store_id": "S",
                                "access": "read_write",
                            }
                        ],
                    },
                )
                assert created.status_code == 201, created.text
                body = created.json()
                memory.mount("dev", body["id"], "S", "read_write")
                return body["id"], body["resources"][0]["mount_path"]

            session_a, mount_path = await open_session()
            session_b, _mount_b = await open_session()
            roles[session_a] = "A"
            roles[session_b] = "B"
            scripts[session_a] = [
                ScriptStep("ready"),
                ScriptStep(
                    "w",
                    [
                        tool_call(
                            "file_write",
                            {"path": f"{mount_path}/a.md", "content": "A2"},
                            "a2",
                        )
                    ],
                ),
                ScriptStep("wrote-a"),
            ]
            scripts[session_b] = [
                ScriptStep("ready"),
                ScriptStep(
                    "w",
                    [
                        tool_call(
                            "file_write",
                            {"path": f"{mount_path}/a.md", "content": "B2"},
                            "b2",
                        )
                    ],
                ),
                ScriptStep("wrote-b"),
                ScriptStep("checked"),
            ]
            await _post(client, session_a, "one")
            await _wait(client, session_a)
            await _post(client, session_b, "one")
            await _wait(client, session_b)

            async def _b_second_turn() -> None:
                await _post(client, session_b, "two")
                await _wait(client, session_b)

            b_turn = asyncio.create_task(_b_second_turn())
            try:
                deadline = time.monotonic() + 15
                while not b_holding.is_set():
                    if b_turn.done() or time.monotonic() > deadline:
                        raise AssertionError(
                            "session B did not reach its stale-baseline write"
                        )
                    await asyncio.sleep(0.05)
                await _post(client, session_a, "two")
                await _wait(client, session_a)
                assert memory.get("S", "/a.md").content == "A2"
            finally:
                a_done.set()
            await b_turn
            rows = await _events(client, session_b)
            assert "memory_write_conflict" in _error_types(rows)
            assert "B2" not in _error_text(rows)
            sid8 = session_b[-8:].lower()
            conflict = f"/a.md.conflict-{sid8}"
            assert memory.get("S", "/a.md").content == "A2"
            assert memory.get("S", conflict).content == "B2"
            await _post(client, session_b, "three")
            await _wait(client, session_b)
            local = (
                home
                / ".agenticx"
                / "sessions"
                / session_b
                / "work"
                / mount_path
                / "a.md"
            )
            assert local.read_text(encoding="utf-8") == "A2"
    finally:
        await app.state.ma.shutdown()


async def test_mount_failure_ends_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _home, config = _prepare(tmp_path, monkeypatch)
    memory = _BoomSnapshot()
    memory.add_store("S", "Notes")
    factory = PerSessionScriptFactory([ScriptStep("should-not-run")])
    app = create_ma_app(config, llm_factory=factory)
    install_memory_mounts(app.state.ma, memory)
    await app.state.ma.startup()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post(
                "/ma/v1/sessions",
                json={
                    "agent_id": "demo",
                    "resources": [{"type": "memory_store", "memory_store_id": "S"}],
                },
            )
            assert created.status_code == 201, created.text
            session_id = created.json()["id"]
            await _post(client, session_id)
            await _wait(client, session_id, "retries_exhausted")
            rows = await _events(client, session_id)
            assert "memory_mount_failed" in _error_types(rows)
            llm = factory.by_session.get(session_id)
            assert llm is None or llm.calls == []
    finally:
        await app.state.ma.shutdown()
