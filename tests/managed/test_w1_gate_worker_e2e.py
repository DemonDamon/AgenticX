#!/usr/bin/env python3
"""W1 desktop-worker gate: host queues work, a local worker runs the turn.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
import yaml

from agenticx.cli.ma_commands import load_fake_llm_script
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep
from agenticx.managed.worker.client import MAWorkerClient
from agenticx.managed.worker.runner import MAWorker, WorkItemRunner
from tests.managed.conftest import make_config

_ROOT = Path(__file__).resolve().parents[2]
_DEVICE = "device-w1a"


def _manifest() -> dict[str, Any]:
    document = yaml.safe_load((_ROOT / "examples/managed/agents.dev.yaml").read_text(encoding="utf-8"))
    manifest = document["agents"][0]["manifest"]
    manifest["model"] = "fake/scripted"
    return manifest


async def _wait_idle(
    client: httpx.AsyncClient,
    session_id: str,
    stop_type: str,
    timeout: float = 30,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        stop = last.get("stop_reason") or {}
        if last.get("status") == "idle" and stop.get("type") == stop_type:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(last)


async def _events(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"/ma/v1/sessions/{session_id}/events",
        params={"limit": 500},
    )
    assert response.status_code == 200, response.text
    return list(response.json()["data"])


def _text(event: dict[str, Any]) -> str:
    content = event.get("content") or []
    if not isinstance(content, list) or not content or not isinstance(content[0], dict):
        return ""
    text = content[0].get("text")
    return text if isinstance(text, str) else ""


def _statuses(store: Any, session_id: str) -> list[str]:
    with store.lock:
        rows = store.connection.execute(
            "SELECT status FROM ma_work_items WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
    return [str(row["status"]) for row in rows]


async def _start_worker(
    live: Any,
    tmp_path: Path,
    *,
    device_id: str,
) -> tuple[MAWorker, asyncio.Task[bool]]:
    steps, fallback = load_fake_llm_script(_ROOT / "examples/managed/w1_fake_script.json")
    client = MAWorkerClient(live.base_url, live.token)
    runner = WorkItemRunner(
        client=client,
        device_id=device_id,
        llm_factory=PerSessionScriptFactory(steps, fallback_text=fallback),
        workdir_root=tmp_path / "worker",
        heartbeat_interval=0.5,
        idle_complete_seconds=0.5,
    )
    worker = MAWorker(
        client=client,
        environment_ids=["worker"],
        device_id=device_id,
        runner=runner,
    )
    task = asyncio.create_task(worker.run_once(max_wait_seconds=10))
    return worker, task


async def test_w1_gate_desktop_worker(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_manifest())
    config.agents["demo"].record.default_environment_id = "worker"
    steps, fallback = load_fake_llm_script(_ROOT / "examples/managed/w1_fake_script.json")
    live = ma_live_server(
        config,
        PerSessionScriptFactory(steps, fallback_text=fallback),
    )
    _worker, task = await _start_worker(live, tmp_path, device_id=_DEVICE)
    async with httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        assert created.json()["environment_id"] == "worker"
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "start"}]}]},
        )
        assert posted.status_code == 200, posted.text
        first = await _wait_idle(client, session_id, "requires_action")
        tool_id = first["stop_reason"]["event_ids"][0]
        rows = await _events(client, session_id)
        tool = next(row for row in rows if row["id"] == tool_id)
        assert tool["type"] == "agent.tool_use"
        assert tool["name"] == "bash_exec"
        assert tool["evaluated_policy"] == "always_ask"
        allowed = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {"type": "user.tool_confirmation", "tool_use_id": tool_id, "result": "allow"}
                ]
            },
        )
        assert allowed.status_code == 200, allowed.text
        second = await _wait_idle(client, session_id, "requires_action")
        custom_id = second["stop_reason"]["event_ids"][0]
        rows = await _events(client, session_id)
        custom = next(row for row in rows if row["id"] == custom_id)
        assert custom["type"] == "agent.custom_tool_use"
        assert custom["name"] == "lookup_order"
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
        await _wait_idle(client, session_id, "end_turn")
        rows = await _events(client, session_id)
        results = [row for row in rows if row["type"] == "agent.tool_result"]
        assert any("ma-w1-ok" in _text(row) for row in results), results
        seqs = [row["seq"] for row in rows]
        assert seqs == list(range(1, len(seqs) + 1))
        assert await asyncio.wait_for(task, timeout=10) is True
        assert _statuses(live.app.state.ma.store, session_id) == ["completed"]
        assert (tmp_path / "worker" / session_id / "work").is_dir()


async def test_worker_interrupt_during_requires_action(
    tmp_path: Path,
    ma_live_server: Any,
) -> None:
    config = make_config(tmp_path, manifest=_manifest())
    config.agents["demo"].record.default_environment_id = "worker"
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("unused")]))
    _worker, task = await _start_worker(live, tmp_path, device_id="device-w1b")
    async with httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "start"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await _wait_idle(client, session_id, "requires_action")
        interrupted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.interrupt"}]},
        )
        assert interrupted.status_code == 200, interrupted.text
        await _wait_idle(client, session_id, "end_turn")
        rows = await _events(client, session_id)
        result = next(row for row in rows if row["type"] == "agent.tool_result")
        assert _text(result).startswith("CANCELLED: interrupted")
        assert await asyncio.wait_for(task, timeout=10) is True
        assert _statuses(live.app.state.ma.store, session_id) == ["completed"]
