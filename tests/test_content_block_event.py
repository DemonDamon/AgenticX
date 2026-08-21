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
    iter_content_block_end_events,
    iter_content_block_start_events,
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


def test_show_images_start_and_end_emit_indexed_remote_urls() -> None:
    from agenticx.studio import server as studio_server

    arguments = {
        "items": [
            {
                "url": "https://example.com/a.jpg",
                "alt": "西装背头造型",
                "source_url": "https://example.com/gallery",
            },
            {"url": "https://example.com/b.png", "alt": "舞台造型"},
        ]
    }
    starts = list(
        iter_content_block_start_events("show_images", "call_abc", arguments, agent_id="meta")
    )
    assert [ev.data["block"]["id"] for ev in starts] == ["img-call_abc-0", "img-call_abc-1"]
    for ev in starts:
        payload = _parse_sse_payload(studio_server._runtime_event_to_sse_lines(ev)[0])
        block = payload["data"]["block"]
        assert payload["type"] == "content_block"
        assert "url" not in block
        assert "path" not in block
        assert block["kind"] == "remote"
        assert "base64" not in json.dumps(payload).lower()

    gallery = json.dumps(
        {
            "type": "image_gallery",
            "images": [
                {
                    "type": "image",
                    "url": "https://example.com/a.jpg",
                    "alt": "西装背头造型",
                    "source_url": "https://example.com/gallery",
                },
                {"type": "image", "url": "https://example.com/b.png", "alt": "舞台造型"},
            ],
        },
        ensure_ascii=False,
    )
    ends = list(
        iter_content_block_end_events(
            "show_images",
            "call_abc",
            arguments=arguments,
            result=gallery,
            agent_id="meta",
        )
    )
    assert len(ends) == 2
    first = _parse_sse_payload(studio_server._runtime_event_to_sse_lines(ends[0])[0])
    block = first["data"]["block"]
    assert first["data"]["mode"] == "end"
    assert block["id"] == "img-call_abc-0"
    assert block["status"] == "ready"
    assert block["url"] == "https://example.com/a.jpg"
    assert block["source_url"] == "https://example.com/gallery"
    assert "path" not in block
    assert "base64" not in json.dumps(first).lower()


def test_show_images_data_url_does_not_become_ready() -> None:
    arguments = {
        "items": [
            {"url": "data:image/png;base64,AAAA"},
            {"url": "https://example.com/ok.jpg"},
        ]
    }
    starts = list(iter_content_block_start_events("show_images", "call_abc", arguments))
    assert [ev.data["block"]["id"] for ev in starts] == ["img-call_abc-0"]
    gallery = json.dumps(
        {
            "type": "image_gallery",
            "images": [
                {"type": "image", "url": "data:image/png;base64,AAAA"},
                {"type": "image", "url": "https://example.com/ok.jpg"},
            ]
        }
    )
    ends = list(
        iter_content_block_end_events(
            "show_images",
            "call_abc",
            arguments=arguments,
            result=gallery,
        )
    )
    assert len(ends) == 1
    assert ends[0].data["block"]["id"] == "img-call_abc-0"
    assert ends[0].data["block"]["status"] == "ready"
    assert ends[0].data["block"]["url"] == "https://example.com/ok.jpg"
    assert "data:image" not in json.dumps(ends[0].data)
