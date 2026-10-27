#!/usr/bin/env python3
"""Server-sent event formatting and parsing for Managed Agents.

Author: Damon Li
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

PING_FRAME = ": ping\n\n"


def format_sse(*, event: str, data: Mapping[str, Any], id: int | str | None = None) -> str:
    """Serialize one SSE message.

    Shape: optional ``id: <id>\\n``, then ``event: <event>\\n``, then
    ``data: <compact json>\\n\\n``.
    """
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    lines: list[str] = []
    if id is not None:
        lines.append(f"id: {id}\n")
    lines.append(f"event: {event}\n")
    lines.append(f"data: {payload}\n\n")
    return "".join(lines)


@dataclass(frozen=True)
class SseMessage:
    """One dispatched SSE message. ``id`` does not carry across messages."""

    id: str | None
    event: str
    data: str

    def json(self) -> Any:
        return json.loads(self.data)


def _split_field(line: str) -> tuple[str, str]:
    name, separator, value = line.partition(":")
    if not separator:
        return name, ""
    if value.startswith(" "):
        value = value[1:]
    return name, value


async def aiter_sse(lines: AsyncIterator[str]) -> AsyncIterator[SseMessage]:
    """Parse ``text/event-stream`` lines, for example ``httpx`` ``aiter_lines``.

    Comment lines (starting with ``:``) are ignored. One optional space after
    the field colon is stripped. Multiple ``data:`` lines join with ``\\n``.
    A blank line dispatches a message only when at least one data line was
    seen. The event name defaults to ``message``. ``id`` applies only to the
    message that contains it.
    """
    event_name = "message"
    data_lines: list[str] = []
    message_id: str | None = None
    saw_data = False

    async for raw_line in lines:
        line = raw_line[:-1] if raw_line.endswith("\n") else raw_line
        if line.endswith("\r"):
            line = line[:-1]
        if line == "":
            if saw_data:
                yield SseMessage(
                    id=message_id,
                    event=event_name,
                    data="\n".join(data_lines),
                )
            event_name = "message"
            data_lines = []
            message_id = None
            saw_data = False
            continue
        if line.startswith(":"):
            continue
        name, value = _split_field(line)
        if name == "id":
            message_id = value
        elif name == "event":
            event_name = value or "message"
        elif name == "data":
            data_lines.append(value)
            saw_data = True


def iter_sse(lines: Iterator[str]) -> Iterator[SseMessage]:
    """Synchronous twin of ``aiter_sse`` with identical parsing rules."""
    event_name = "message"
    data_lines: list[str] = []
    message_id: str | None = None
    saw_data = False

    for raw_line in lines:
        line = raw_line[:-1] if raw_line.endswith("\n") else raw_line
        if line.endswith("\r"):
            line = line[:-1]
        if line == "":
            if saw_data:
                yield SseMessage(
                    id=message_id,
                    event=event_name,
                    data="\n".join(data_lines),
                )
            event_name = "message"
            data_lines = []
            message_id = None
            saw_data = False
            continue
        if line.startswith(":"):
            continue
        name, value = _split_field(line)
        if name == "id":
            message_id = value
        elif name == "event":
            event_name = value or "message"
        elif name == "data":
            data_lines.append(value)
            saw_data = True


__all__ = [
    "PING_FRAME",
    "SseMessage",
    "aiter_sse",
    "format_sse",
    "iter_sse",
]
