#!/usr/bin/env python3
"""Thread list, event history, SSE, and archive routes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx

from agenticx.managed.sse import aiter_sse
from agenticx.managed.testing import ScriptStep, ThreadScriptFactory, tool_call
from tests.managed.conftest import LiveServer
from tests.managed.test_threads import (
    coordinator_agents,
    create_session,
    events_of,
    host_config,
    hosted,
    post_event,
    user_message,
    wait_idle,
)


def _factory() -> ThreadScriptFactory:
    return ThreadScriptFactory(
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


async def test_threads_list_get_events(tmp_path: Path) -> None:
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, _factory()) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id)
        listed = await client.get(f"/ma/v1/sessions/{session_id}/threads")
        assert listed.status_code == 200, listed.text
        threads = listed.json()["data"]
        assert len(threads) == 2
        primary = next(item for item in threads if item["is_primary"])
        assert primary["id"] == session_id
        member = next(item for item in threads if not item["is_primary"])
        assert member["agent"]["agent_id"] == "B"
        assert member["status"] == "idle"
        tid = member["id"]
        detail = await client.get(f"/ma/v1/sessions/{session_id}/threads/{tid}")
        assert detail.status_code == 200
        assert detail.json()["thread"]["id"] == tid
        member_events = await client.get(
            f"/ma/v1/sessions/{session_id}/threads/{tid}/events",
            params={"limit": 500},
        )
        assert member_events.status_code == 200
        body = member_events.json()["data"]
        assert any(row["type"] == "agent.tool_use" and row["name"] == "file_write" for row in body)
        assert all(row["thread_id"] == tid for row in body)
        primary_events = await client.get(
            f"/ma/v1/sessions/{session_id}/threads/{session_id}/events",
            params={"limit": 500},
        )
        assert primary_events.status_code == 200
        assert all(not row.get("thread_id") for row in primary_events.json()["data"])
        missing = await client.get(f"/ma/v1/sessions/{session_id}/threads/bogus")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "thread_not_found"


async def test_thread_stream_replays_and_filters(tmp_path: Path, ma_live_server: Any) -> None:
    config = host_config(tmp_path, coordinator_agents())
    config.sse_ping_seconds = 0.4
    live: LiveServer = ma_live_server(config, _factory())
    async with httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        await wait_idle(client, session_id, timeout=12)
        rows = await events_of(client, session_id)
        tid = next(row["thread_id"] for row in rows if row["type"] == "session.thread_created")
        member_history = (
            await client.get(f"/ma/v1/sessions/{session_id}/threads/{tid}/events", params={"limit": 500})
        ).json()["data"]
        seen: list[tuple[str, dict[str, Any]]] = []

        async def _read(url: str, headers: dict[str, str] | None, limit: int) -> list[tuple[str | None, dict[str, Any]]]:
            frames: list[tuple[str | None, dict[str, Any]]] = []
            async with client.stream("GET", url, headers=headers, params={"after_seq": 0} if not headers else None) as response:
                assert response.status_code == 200, response.text
                async for message in aiter_sse(response.aiter_lines()):
                    if message.id is None:
                        continue
                    frames.append((message.id, message.json()))
                    if len(frames) >= limit:
                        return frames
            return frames

        thread_url = f"/ma/v1/sessions/{session_id}/threads/{tid}/events/stream"
        replay = await asyncio.wait_for(_read(thread_url, None, len(member_history)), timeout=8)
        assert len(replay) == len(member_history)
        assert all(frame["thread_id"] == tid for _id, frame in replay)
        assert [int(str(frame_id)) for frame_id, _frame in replay] == [row["seq"] for row in member_history]
        last_seq = member_history[-1]["seq"]
        resumed: list[tuple[str | None, dict[str, Any]]] = []

        async def _resume() -> None:
            async with client.stream(
                "GET",
                thread_url,
                headers={"Last-Event-ID": str(last_seq)},
            ) as response:
                assert response.status_code == 200
                async for message in aiter_sse(response.aiter_lines()):
                    if message.id is None:
                        return
                    resumed.append((message.id, message.json()))

        resume_task = asyncio.create_task(_resume())
        await asyncio.sleep(0.6)
        resume_task.cancel()
        await asyncio.gather(resume_task, return_exceptions=True)
        assert all(int(str(frame_id)) > last_seq for frame_id, _frame in resumed)
        session_frames = await asyncio.wait_for(
            _read(f"/ma/v1/sessions/{session_id}/events/stream", None, len(rows)),
            timeout=8,
        )
        assert session_frames
        assert not any(
            frame.get("thread_id") and frame["type"] == "agent.tool_use" for _id, frame in session_frames
        )
        seen.extend((str(frame_id), frame) for frame_id, frame in replay)


async def test_archive_rules(tmp_path: Path) -> None:
    factory = ThreadScriptFactory(
        {
            "primary": [
                ScriptStep("go", [tool_call("send_to_agent", {"agent": "B", "message": "sleep"}, "s1")]),
                ScriptStep("waiting"),
                ScriptStep("done"),
            ],
            "agent:B": [ScriptStep("sleep", [tool_call("bash_exec", {"command": "sleep 30"}, "b1")])],
        }
    )
    config = host_config(tmp_path, coordinator_agents())
    async with hosted(config, factory) as (_app, client):
        session_id = await create_session(client)
        assert (await post_event(client, session_id, user_message("go"))).status_code == 200
        tid = ""
        deadline = asyncio.get_running_loop().time() + 5
        while asyncio.get_running_loop().time() < deadline and not tid:
            listed = await client.get(f"/ma/v1/sessions/{session_id}/threads")
            for item in listed.json().get("data", []):
                if not item["is_primary"] and item["status"] == "running":
                    tid = item["id"]
            await asyncio.sleep(0.05)
        assert tid
        running = await client.post(f"/ma/v1/sessions/{session_id}/threads/{tid}/archive")
        assert running.status_code == 400
        assert running.json()["error"]["message"] == "thread must be idle to archive"
        primary = await client.post(f"/ma/v1/sessions/{session_id}/threads/{session_id}/archive")
        assert primary.status_code == 400
        assert primary.json()["error"]["message"] == "primary thread cannot be archived"
        assert (await post_event(client, session_id, {"type": "user.interrupt"})).status_code == 200
        await wait_idle(client, session_id, timeout=8)
        archived = await client.post(f"/ma/v1/sessions/{session_id}/threads/{tid}/archive")
        assert archived.status_code == 200, archived.text
        assert archived.json()["thread"]["archived_at"]
        again = await client.post(f"/ma/v1/sessions/{session_id}/threads/{tid}/archive")
        assert again.status_code == 200
        assert again.json()["thread"]["archived_at"] == archived.json()["thread"]["archived_at"]
        hidden = await client.get(f"/ma/v1/sessions/{session_id}/threads", params={"include_archived": False})
        assert all(item["id"] != tid for item in hidden.json()["data"])
        shown = await client.get(f"/ma/v1/sessions/{session_id}/threads", params={"include_archived": True})
        assert any(item["id"] == tid for item in shown.json()["data"])
