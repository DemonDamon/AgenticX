#!/usr/bin/env python3
"""Tests for RuntimeEvent CONTENT_BLOCK SSE serialization.

Author: Damon Li
"""

from __future__ import annotations

import json

from agenticx.runtime.events import (
    EventType,
    RuntimeEvent,
    build_content_block_end_event,
    build_content_block_start_event,
)


def _parse_sse_payload(line: str) -> dict:
    return json.loads(line.removeprefix("data: ").strip())


def test_content_block_start_serializes_without_path_or_bytes() -> None:
    from agenticx.studio import server as studio_server

    ev = build_content_block_start_event(
        tool_call_id="call_abc",
        prompt="画一只橘猫坐在窗台上晒太阳",
        agent_id="meta",
    )
    lines = studio_server._runtime_event_to_sse_lines(ev)
    assert len(lines) == 1
    payload = _parse_sse_payload(lines[0])
    assert payload["type"] == "content_block"
    assert payload["data"]["mode"] == "start"
    assert payload["data"]["agent_id"] == "meta"
    block = payload["data"]["block"]
    assert block["id"] == "img-call_abc"
    assert block["type"] == "image"
    assert block["status"] == "generating"
    assert "path" not in block
    assert "url" not in block
    dumped = json.dumps(payload)
    assert "base64" not in dumped.lower()
    assert "data:image" not in dumped


def test_content_block_end_uses_absolute_path_and_stays_small() -> None:
    from agenticx.studio import server as studio_server

    result = json.dumps(
        {
            "type": "image",
            "path": "/Users/me/.agenticx/sessions/s1/workspace/generated/img-xxx.png",
            "mime": "image/png",
            "alt": "cat",
            "width": 1024,
            "height": 1024,
        }
    )
    ev = build_content_block_end_event(
        tool_call_id="call_abc",
        result=result,
        prompt="cat",
        agent_id="meta",
    )
    lines = studio_server._runtime_event_to_sse_lines(ev)
    payload = _parse_sse_payload(lines[0])
    assert payload["type"] == EventType.CONTENT_BLOCK.value
    block = payload["data"]["block"]
    assert payload["data"]["mode"] == "end"
    assert block["id"] == "img-call_abc"
    assert block["status"] == "ready"
    assert block["path"] == "/Users/me/.agenticx/sessions/s1/workspace/generated/img-xxx.png"
    serialized = json.dumps(payload, ensure_ascii=False)
    assert len(serialized.encode("utf-8")) < 8 * 1024
    assert "base64" not in serialized.lower()


def test_content_block_direct_runtime_event_roundtrip() -> None:
    from agenticx.studio import server as studio_server

    ev = RuntimeEvent(
        type="content_block",
        data={
            "mode": "start",
            "block": {
                "type": "image",
                "id": "img-x",
                "status": "generating",
                "source": "tool",
            },
        },
        agent_id="meta",
    )
    payload = _parse_sse_payload(studio_server._runtime_event_to_sse_lines(ev)[0])
    assert payload["type"] == "content_block"
    assert payload["data"]["mode"] == "start"
    assert payload["data"]["block"]["id"] == "img-x"
