#!/usr/bin/env python3
"""SSE replay, resume, previews, and archive for the managed host.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx

from agenticx.managed.ids import new_ulid
from agenticx.managed.sse import aiter_sse
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep
from tests.managed.conftest import LiveServer, make_config


def _plain() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Reply briefly.",
        "runtime": {"max_tool_rounds": 4},
    }


def _client(live: LiveServer) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=live.base_url,
        headers={"Authorization": f"Bearer {live.token}"},
        timeout=30,
        trust_env=False,
    )


async def _create_and_finish(client: httpx.AsyncClient, text: str) -> str:
    created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]
    posted = await client.post(
        f"/ma/v1/sessions/{session_id}/events",
        json={"events": [{"type": "user.message", "content": [{"type": "text", "text": text}]}]},
    )
    assert posted.status_code == 200, posted.text
    deadline = asyncio.get_running_loop().time() + 15
    while asyncio.get_running_loop().time() < deadline:
        record = await client.get(f"/ma/v1/sessions/{session_id}")
        body = record.json()
        stop = body.get("stop_reason") or {}
        if body.get("status") == "idle" and stop.get("type") == "end_turn":
            return session_id
        await asyncio.sleep(0.1)
    raise AssertionError(record.text)


async def test_stream_replay_then_live(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    config.sse_ping_seconds = 0.5
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("first"), ScriptStep("second")]))
    async with _client(live) as client:
        session_id = await _create_and_finish(client, "one")
        stored = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
        history = stored.json()["data"]
        assert history
        seen: list[tuple[int, str]] = []
        pinged = asyncio.Event()
        history_seen = asyncio.Event()
        done = asyncio.Event()

        async def _tap(lines: Any) -> Any:
            async for line in lines:
                if isinstance(line, str) and line.startswith(":"):
                    pinged.set()
                yield line

        async def _read() -> None:
            async with client.stream(
                "GET",
                f"/ma/v1/sessions/{session_id}/events/stream",
                params={"after_seq": 0},
            ) as response:
                assert response.status_code == 200
                async for message in aiter_sse(_tap(response.aiter_lines())):
                    if message.id is None:
                        continue
                    seen.append((int(message.id), message.event))
                    if len(seen) >= len(history):
                        history_seen.set()
                    if (
                        history_seen.is_set()
                        and message.event == "session.status_idle"
                        and int(message.id) > history[-1]["seq"]
                    ):
                        done.set()
                        return

        task = asyncio.create_task(_read())
        await asyncio.wait_for(history_seen.wait(), timeout=10)
        assert seen[: len(history)] == [(row["seq"], row["type"]) for row in history]
        await asyncio.wait_for(pinged.wait(), timeout=2)
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "two"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await asyncio.wait_for(done.wait(), timeout=15)
        task.cancel()
        assert any(seq > history[-1]["seq"] and event == "agent.message" for seq, event in seen)


async def test_last_event_id_resume_no_loss_no_dup(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("first"), ScriptStep("second")]))
    async with _client(live) as client:
        session_id = await _create_and_finish(client, "one")
        first: list[int] = []
        async with client.stream("GET", f"/ma/v1/sessions/{session_id}/events/stream") as response:
            assert response.status_code == 200
            async for message in aiter_sse(response.aiter_lines()):
                if message.id is None:
                    continue
                first.append(int(message.id))
                if int(message.id) >= 3:
                    break
        k = first[-1]
        before = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
        before_max = before.json()["data"][-1]["seq"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "two"}]}]},
        )
        deadline = asyncio.get_running_loop().time() + 15
        while asyncio.get_running_loop().time() < deadline:
            listed = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
            fresh_idle = [
                row
                for row in listed.json()["data"]
                if row["type"] == "session.status_idle" and row["seq"] > before_max
            ]
            if fresh_idle and fresh_idle[-1]["stop_reason"]["type"] == "end_turn":
                break
            await asyncio.sleep(0.1)
        else:
            raise AssertionError("second turn did not finish")
        stored = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 500})
        stored_seqs = [row["seq"] for row in stored.json()["data"]]
        second: list[int] = []
        async with client.stream(
            "GET",
            f"/ma/v1/sessions/{session_id}/events/stream",
            headers={"Last-Event-ID": str(k)},
        ) as response:
            assert response.status_code == 200
            async for message in aiter_sse(response.aiter_lines()):
                if message.id is None:
                    continue
                second.append(int(message.id))
                if int(message.id) == stored_seqs[-1]:
                    break
        assert second[0] == k + 1
        merged = first + second
        assert merged == stored_seqs
        assert len(merged) == len(set(merged))
        assert merged == list(range(1, max(merged) + 1))
        async with client.stream(
            "GET",
            f"/ma/v1/sessions/{session_id}/events/stream",
            params={"after_seq": 1},
            headers={"Last-Event-ID": str(k)},
        ) as response:
            assert response.status_code == 200
            async for message in aiter_sse(response.aiter_lines()):
                if message.id is None:
                    continue
                assert int(message.id) == k + 1
                break


async def test_event_deltas_opt_in(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    config.sse_ping_seconds = 0.2
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("hi")]))
    async with _client(live) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        session_id = created.json()["id"]
        url = f"/ma/v1/sessions/{session_id}/events/stream"
        frame = {
            "type": "event_delta",
            "event_type": "agent.message",
            "content_delta": "x",
        }

        opt_lines: asyncio.Queue[str] = asyncio.Queue()
        plain_lines: asyncio.Queue[str] = asyncio.Queue()
        opt_ready = asyncio.Event()
        plain_ready = asyncio.Event()

        async def _pump(response: httpx.Response, queue: asyncio.Queue[str], ready: asyncio.Event) -> None:
            async for line in response.aiter_lines():
                await queue.put(line)
                if line.startswith(":"):
                    ready.set()

        async with client.stream("GET", url, params=[("event_deltas[]", "agent.message")]) as opted:
            async with client.stream("GET", url) as plain:
                assert opted.status_code == 200
                assert plain.status_code == 200
                opt_task = asyncio.create_task(_pump(opted, opt_lines, opt_ready))
                plain_task = asyncio.create_task(_pump(plain, plain_lines, plain_ready))
                await asyncio.wait_for(opt_ready.wait(), timeout=2)
                await asyncio.wait_for(plain_ready.wait(), timeout=2)
                live.loop.call_soon_threadsafe(
                    live.app.state.ma.event_log.publish_preview,
                    session_id,
                    frame,
                )
                raw: list[str] = []
                while True:
                    line = await asyncio.wait_for(opt_lines.get(), timeout=2)
                    raw.append(line)
                    if line == "" and any("event_delta" in item for item in raw):
                        break
                assert any(line.startswith("event:") and "event_delta" in line for line in raw)
                assert not any(line.startswith("id:") for line in raw)
                missed_lines: list[str] = []
                drain_deadline = asyncio.get_running_loop().time() + 0.6
                while asyncio.get_running_loop().time() < drain_deadline:
                    try:
                        missed_lines.append(
                            await asyncio.wait_for(plain_lines.get(), timeout=0.2)
                        )
                    except TimeoutError:
                        break
                assert not any("event_delta" in line for line in missed_lines)
                opt_task.cancel()
                plain_task.cancel()


async def test_archive_closes_stream(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    config.sse_ping_seconds = 0.2
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("hi")]))
    async with _client(live) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        session_id = created.json()["id"]

        async def _consume(response: httpx.Response) -> None:
            archived = False
            async for line in response.aiter_lines():
                if not archived and line.startswith(":"):
                    result = await client.post(f"/ma/v1/sessions/{session_id}/archive")
                    assert result.status_code == 200, result.text
                    archived = True
            assert archived

        async with client.stream("GET", f"/ma/v1/sessions/{session_id}/events/stream") as response:
            assert response.status_code == 200
            await asyncio.wait_for(_consume(response), timeout=5)


async def test_bad_last_event_id(tmp_path: Path, ma_live_server: Any) -> None:
    config = make_config(tmp_path, manifest=_plain())
    live = ma_live_server(config, PerSessionScriptFactory([ScriptStep("hi")]))
    async with _client(live) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        session_id = created.json()["id"]
        bad = await client.get(
            f"/ma/v1/sessions/{session_id}/events/stream",
            headers={"Last-Event-ID": "abc"},
        )
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "invalid_request"
        missing = await client.get(f"/ma/v1/sessions/{new_ulid()}/events/stream")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "session_not_found"
