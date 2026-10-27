#!/usr/bin/env python3
"""W1 acceptance gate for the in-process cloud Managed Agents host.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

import httpx

from agenticx.managed.sse import SseMessage, aiter_sse


def _stop_type(message: SseMessage) -> str | None:
    if message.event != "session.status_idle":
        return None
    stop = message.json().get("stop_reason") or {}
    stop_type = stop.get("type")
    return stop_type if isinstance(stop_type, str) else None


def _block_text(event: dict[str, Any]) -> str:
    content = event.get("content") or []
    if not isinstance(content, list) or not content:
        return ""
    first = content[0]
    if isinstance(first, dict) and isinstance(first.get("text"), str):
        return first["text"]
    return ""


async def _read_until(
    client: httpx.AsyncClient,
    url: str,
    sink: list[tuple[int, str, dict[str, Any]]],
    predicate: Any,
    headers: dict[str, str] | None = None,
) -> None:
    async with client.stream("GET", url, headers=headers) as response:
        response.raise_for_status()
        async for message in aiter_sse(response.aiter_lines()):
            if message.id is not None and str(message.id).isdigit():
                sink.append((int(message.id), message.event, message.json()))
            if predicate(message):
                return


async def run_w1_gate(
    *,
    base_url: str,
    token: str,
    agent_id: str = "demo",
    timeout: float = 120,
) -> None:
    """Run the cloud W1 gate. Raises AssertionError when a step fails."""
    headers = {"Authorization": f"Bearer {token}"}
    deadline = asyncio.get_running_loop().time() + timeout
    async with httpx.AsyncClient(
        base_url=base_url,
        headers=headers,
        timeout=timeout,
        trust_env=False,
    ) as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": agent_id})
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        print(f"[step 1] created session {session_id}")
        stream_url = f"/ma/v1/sessions/{session_id}/events/stream"
        events_url = f"/ma/v1/sessions/{session_id}/events"
        list_a: list[tuple[int, str, dict[str, Any]]] = []

        def needs_action(message: SseMessage) -> bool:
            return _stop_type(message) == "requires_action"

        task_a = asyncio.create_task(
            _read_until(client, stream_url, list_a, needs_action)
        )
        await asyncio.sleep(0.05)
        posted = await client.post(
            events_url,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "start"}]}]},
        )
        print("[step 2] subscribed; [step 3] sent user.message")
        assert posted.status_code == 200, posted.text
        await asyncio.wait_for(task_a, timeout=max(1.0, deadline - asyncio.get_running_loop().time()))
        print("[step 4] first stream closed on requires_action")
        idle = next(item for item in reversed(list_a) if item[1] == "session.status_idle")
        tool_use_id = idle[2]["stop_reason"]["event_ids"][0]
        tool_use = next(item for item in list_a if item[2].get("id") == tool_use_id)
        assert tool_use[1] == "agent.tool_use", tool_use
        assert tool_use[2]["name"] == "bash_exec"
        assert tool_use[2]["evaluated_policy"] == "always_ask"
        max_seq = max(seq for seq, _event_type, _data in list_a)
        list_b: list[tuple[int, str, dict[str, Any]]] = []

        def ended(message: SseMessage) -> bool:
            return _stop_type(message) == "end_turn"

        task_b = asyncio.create_task(
            _read_until(
                client,
                stream_url,
                list_b,
                ended,
                headers={"Last-Event-ID": str(max_seq)},
            )
        )
        print(f"[step 5] resumed from Last-Event-ID {max_seq}")
        allowed = await client.post(
            events_url,
            json={
                "events": [
                    {
                        "type": "user.tool_confirmation",
                        "tool_use_id": tool_use_id,
                        "result": "allow",
                    }
                ]
            },
        )
        print("[step 6] allowed bash_exec")
        assert allowed.status_code == 200, allowed.text
        custom_id = ""
        while True:
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError("timed out waiting for custom tool use")
            listed = await client.get(
                events_url,
                params={"types": "session.status_idle", "after_seq": max_seq, "limit": 100},
            )
            assert listed.status_code == 200, listed.text
            for row in listed.json()["data"]:
                stop = row.get("stop_reason") or {}
                if stop.get("type") == "requires_action":
                    custom_id = stop["event_ids"][0]
                    break
            if custom_id:
                break
            await asyncio.sleep(0.1)
        full = await client.get(events_url, params={"after_seq": max_seq, "limit": 500})
        assert full.status_code == 200, full.text
        custom = next(row for row in full.json()["data"] if row["id"] == custom_id)
        assert custom["type"] == "agent.custom_tool_use", custom
        assert custom["name"] == "lookup_order"
        print("[step 7] saw lookup_order")
        answered = await client.post(
            events_url,
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
        print("[step 8] returned custom tool result")
        assert answered.status_code == 200, answered.text
        await asyncio.wait_for(task_b, timeout=max(1.0, deadline - asyncio.get_running_loop().time()))
        print("[step 9] second stream closed on end_turn")
        tool_results = [item[2] for item in list_b if item[1] == "agent.tool_result"]
        assert any("ma-w1-ok" in _block_text(item) for item in tool_results), tool_results
        last_idle = [item for item in list_b if item[1] == "session.status_idle"][-1]
        assert last_idle[2]["stop_reason"]["type"] == "end_turn"
        seqs = [seq for seq, _event_type, _data in list_a] + [seq for seq, _event_type, _data in list_b]
        assert len(seqs) == len(set(seqs)), seqs
        assert sorted(seqs) == list(range(1, max(seqs) + 1)), seqs
        everything = await client.get(events_url, params={"limit": 500})
        assert everything.status_code == 200, everything.text
        stored_seqs = [row["seq"] for row in everything.json()["data"]]
        assert stored_seqs == sorted(seqs), (stored_seqs, sorted(seqs))
        print("[step 10] resume lost nothing and duplicated nothing")
        print("W1 GATE PASSED")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Managed Agents W1 cloud gate")
    parser.add_argument("--base-url", default="http://127.0.0.1:8092")
    parser.add_argument("--token", required=True)
    parser.add_argument("--agent-id", default="demo")
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args(argv)
    try:
        asyncio.run(
            run_w1_gate(
                base_url=args.base_url,
                token=args.token,
                agent_id=args.agent_id,
                timeout=args.timeout,
            )
        )
    except Exception as exc:
        print(f"W1 GATE FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
