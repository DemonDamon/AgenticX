#!/usr/bin/env python3
"""Pending background work and queued wake-ups for one managed session.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

from agenticx.managed.events.store import StoredEvent

WakeSource = Literal["task", "thread"]
_WAKE_OUTPUT_CHARS = 4000


@dataclass(frozen=True)
class WakeUp:
    """A persisted notification that must start the next primary turn."""

    source: WakeSource
    event: StoredEvent


class TurnContinuation:
    """Pending background units and queued wake-ups of one session.

    Only the primary-turn loop awaits ``wait()``. Producers call
    ``register_pending`` before starting a unit and ``resolve_pending`` exactly
    once when it ends. ``poke()`` wakes the waiter without a wake-up so it can
    re-check the user message queue or the stop flag.
    """

    def __init__(self) -> None:
        self._pending: set[str] = set()
        self._queue: list[WakeUp] = []
        self._signal = asyncio.Event()
        self._closed = False
        self._poked = False

    def register_pending(self, key: str) -> None:
        self._pending.add(key)

    def resolve_pending(self, key: str, wake: WakeUp | None) -> None:
        """Drop ``key``; enqueue ``wake`` when given and not closed; set the signal.

        Resolving a key that is not pending has no effect.
        """
        if key not in self._pending:
            return
        self._pending.discard(key)
        if wake is not None and not self._closed:
            self._queue.append(wake)
        self._signal.set()

    def poke(self) -> None:
        self._poked = True
        self._signal.set()

    @property
    def has_pending(self) -> bool:
        return bool(self._pending) or bool(self._queue)

    def pending_keys(self) -> frozenset[str]:
        return frozenset(self._pending)

    async def wait(self) -> WakeUp | None:
        """Return the oldest queued wake-up.

        Returns None when poked, when closed, or when nothing is pending and the
        queue is empty. Never blocks when ``has_pending`` is False.
        """
        while True:
            if self._queue:
                self._poked = False
                return self._queue.pop(0)
            if self._closed or not self._pending:
                self._poked = False
                return None
            if self._poked:
                self._poked = False
                return None
            self._signal.clear()
            if self._queue or self._closed or not self._pending or self._poked:
                continue
            await self._signal.wait()

    def close(self) -> None:
        """Drop queued wake-ups, mark closed, set the signal.

        Pending keys are kept for accounting until ``resolve_pending``.
        """
        self._queue.clear()
        self._closed = True
        self._signal.set()

    def reopen(self) -> None:
        """Clear the closed flag at the start of a new user turn."""
        self._closed = False


def _content_text(payload: dict[str, object] | object) -> str:
    content = payload.get("content") if isinstance(payload, dict) else None
    lines: list[str] = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                lines.append(block["text"])
    return "\n".join(lines)


def wake_text(event: StoredEvent) -> str:
    """Model-facing text for a wake-up event."""
    if event.type == "agent.thread_message_received":
        payload = event.payload
        name = payload.get("from_agent_name") if isinstance(payload, dict) else ""
        thread_id = payload.get("from_thread_id") if isinstance(payload, dict) else ""
        name_text = name if isinstance(name, str) else ""
        thread_text = thread_id if isinstance(thread_id, str) else ""
        return (
            f"[report from member {name_text} (thread {thread_text})]\n"
            f"{_content_text(payload)}"
        )
    if event.type != "session.task_completed":
        raise ValueError(f"no wake text for {event.type}")
    payload = event.payload
    task_id = payload.get("task_id", "")
    state = payload.get("state", "")
    summary = payload.get("summary") or ""
    result = payload.get("result")
    exit_code = None
    output = ""
    if isinstance(result, dict):
        exit_code = result.get("exit_code")
        raw_output = result.get("output")
        if isinstance(raw_output, str):
            output = raw_output
    shown = output[-_WAKE_OUTPUT_CHARS:] if output else "(empty)"
    exit_display = "null" if exit_code is None else str(exit_code)
    return (
        "[background task notification]\n"
        f"task_id={task_id} state={state} exit_code={exit_display}\n"
        f"command: {summary}\n"
        "output (tail):\n"
        f"{shown}"
    )


__all__ = [
    "WakeSource",
    "WakeUp",
    "TurnContinuation",
    "wake_text",
]
