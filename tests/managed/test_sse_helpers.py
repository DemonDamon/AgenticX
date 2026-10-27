#!/usr/bin/env python3
"""SSE frame formatting and parsing.

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from agenticx.managed.sse import PING_FRAME, aiter_sse, format_sse


async def _lines(text: str) -> AsyncIterator[str]:
    for line in text.splitlines():
        yield line


async def test_format_and_parse_roundtrip() -> None:
    frame = format_sse(event="agent.message", data={"a": 1}, id=3)
    assert frame == 'id: 3\nevent: agent.message\ndata: {"a":1}\n\n'
    multiline = "event: note\ndata: hello\ndata: world\n\n"
    messages = [item async for item in aiter_sse(_lines(frame + PING_FRAME + multiline))]
    assert len(messages) == 2
    assert messages[0].id == "3"
    assert messages[0].json() == {"a": 1}
    assert messages[0].event == "agent.message"
    assert messages[1].id is None
    assert messages[1].event == "note"
    assert messages[1].data == "hello\nworld"
