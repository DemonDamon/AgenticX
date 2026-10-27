#!/usr/bin/env python3
"""HTTP task list, detail, and cancel.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import Principal
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, tool_call
from tests.managed.conftest import dev_principal, make_config


def _manifest() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "test",
        "tools": [{"type": "agx_builtin", "default_policy": "always_allow"}],
        "runtime": {"max_tool_rounds": 4},
    }


async def _wait_task(client: httpx.AsyncClient, session_id: str) -> str:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}/tasks")
        if response.status_code == 200 and response.json()["data"]:
            return str(response.json()["data"][0]["task_id"])
        await asyncio.sleep(0.05)
    raise AssertionError("task was not listed")


async def test_list_get_cancel(tmp_path: Path) -> None:
    tokens = {
        "test-token": dev_principal("dev"),
        "read-token": Principal(
            tenant_id="dev",
            user_id="reader",
            scopes=frozenset({"ma:sessions:read"}),
        ),
        "other-token": Principal(
            tenant_id="other",
            user_id="other-user",
            scopes=frozenset({"ma:sessions:read", "ma:sessions:write"}),
        ),
    }
    config = make_config(tmp_path, manifest=_manifest(), tokens=tokens)
    config.tasks_enabled = True
    config.task_foreground_seconds = 0.2
    factory = PerSessionScriptFactory(
        [
            ScriptStep(
                "checking",
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
            ),
            ScriptStep("armed"),
        ]
    )
    app = create_ma_app(config, llm_factory=factory)
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
            posted = await client.post(
                f"/ma/v1/sessions/{session_id}/events",
                json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "go"}]}]},
            )
            assert posted.status_code == 200, posted.text
            task_id = await _wait_task(client, session_id)
            listed = await client.get(f"/ma/v1/sessions/{session_id}/tasks")
            assert listed.status_code == 200
            assert listed.json()["data"][0]["task_id"] == task_id
            detail = await client.get(f"/ma/v1/sessions/{session_id}/tasks/{task_id}")
            assert detail.status_code == 200, detail.text
            assert "output" in detail.json()["task"]["result"]
            cancelled = await client.post(f"/ma/v1/sessions/{session_id}/tasks/{task_id}/cancel")
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()["task"]["state"] == "cancelled"
            again = await client.post(f"/ma/v1/sessions/{session_id}/tasks/{task_id}/cancel")
            assert again.status_code == 200, again.text
            assert again.json()["task"]["state"] == "cancelled"
            missing = await client.get(f"/ma/v1/sessions/{session_id}/tasks/01JNOTASK00000000000000000")
            assert missing.status_code == 404
            assert missing.json()["error"]["code"] == "task_not_found"
            bogus = await client.get(f"/ma/v1/sessions/{session_id}/tasks", params={"state": "bogus"})
            assert bogus.status_code == 400
            assert bogus.json()["error"]["code"] == "invalid_request"
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer other-token"},
            timeout=30,
            trust_env=False,
        ) as other:
            foreign = await other.get(f"/ma/v1/sessions/{session_id}/tasks")
            assert foreign.status_code == 404
            assert foreign.json()["error"]["code"] == "session_not_found"
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ma",
            headers={"Authorization": "Bearer read-token"},
            timeout=30,
            trust_env=False,
        ) as reader:
            forbidden = await reader.post(f"/ma/v1/sessions/{session_id}/tasks/{task_id}/cancel")
            assert forbidden.status_code == 403
            assert forbidden.json()["error"]["code"] == "forbidden_scope"
    finally:
        await app.state.ma.shutdown()


async def test_startup_marks_dangling_tasks_failed(tmp_path: Path) -> None:
    from agenticx.managed.host.tasks import task_created_event
    from agenticx.managed.ids import new_ulid

    config = make_config(tmp_path, manifest=_manifest())
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    await app.state.ma.startup()
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
    await app.state.ma.service.store.update_session(
        "dev",
        session_id,
        {"status": "running", "stop_reason": None},
    )
    await app.state.ma.service.event_log.append(
        "dev",
        session_id,
        [
            task_created_event(
                task_id=new_ulid(),
                tool_name="bash_exec",
                tool_use_id=None,
                summary="sleep 30",
                log_path=".ma/tasks/lost.log",
            )
        ],
    )
    await app.state.ma.shutdown()

    restarted = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    await restarted.state.ma.startup()
    try:
        rows = await restarted.state.ma.service.store.list_events("dev", session_id, limit=50)
    finally:
        await restarted.state.ma.shutdown()
    types = [(row.type, (row.payload.get("error") or {}).get("type") if row.type != "session.task_completed" else row.payload.get("error", {}).get("type"), row.payload.get("state")) for row in rows]
    completed = next(index for index, row in enumerate(rows) if row.type == "session.task_completed")
    restarted_error = next(
        index
        for index, row in enumerate(rows)
        if row.type == "session.error" and (row.payload.get("error") or {}).get("type") == "host_restarted"
    )
    assert rows[completed].payload["state"] == "failed"
    assert rows[completed].payload["error"]["type"] == "host_restarted"
    assert completed < restarted_error
    del types
