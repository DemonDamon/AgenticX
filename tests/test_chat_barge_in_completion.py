#!/usr/bin/env python3
"""Tests for the interrupted chat runtime completion barrier.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from agenticx.studio.session_manager import SessionManager


class _FakeManager:
    def __init__(self, *, interrupted: bool, hub: SimpleNamespace | None) -> None:
        self.interrupted = interrupted
        self.hub = hub

    def should_interrupt(self, _session_id: str) -> bool:
        return self.interrupted

    def get_event_hub(self, _session_id: str) -> SimpleNamespace | None:
        return self.hub


@pytest.mark.asyncio
async def test_wait_for_interrupted_runtime_returns_after_hub_finishes() -> None:
    hub = SimpleNamespace(is_active=True, is_runtime_done=False)
    manager = _FakeManager(interrupted=True, hub=hub)

    async def finish_runtime() -> None:
        await asyncio.sleep(0.01)
        hub.is_runtime_done = True
        hub.is_active = False
        await asyncio.sleep(0.01)
        manager.hub = None

    finisher = asyncio.create_task(finish_runtime())
    settled = await SessionManager.wait_for_interrupted_runtime(
        manager,
        "session-a",
        timeout_seconds=0.2,
        poll_interval_seconds=0.005,
    )

    assert settled is True
    assert finisher.done() is True


@pytest.mark.asyncio
async def test_wait_for_interrupted_runtime_times_out_while_hub_stays_active() -> None:
    hub = SimpleNamespace(is_active=True, is_runtime_done=False)
    manager = _FakeManager(interrupted=True, hub=hub)

    settled = await SessionManager.wait_for_interrupted_runtime(
        manager,
        "session-a",
        timeout_seconds=0.02,
        poll_interval_seconds=0.005,
    )

    assert settled is False
    assert manager.interrupted is True


@pytest.mark.asyncio
async def test_wait_for_previous_runtime_does_not_require_interrupt_flag() -> None:
    hub = SimpleNamespace(is_active=True, is_runtime_done=False)
    manager = _FakeManager(interrupted=False, hub=hub)

    settled = await SessionManager.wait_for_interrupted_runtime(
        manager,
        "session-a",
        timeout_seconds=0.01,
        poll_interval_seconds=0.005,
    )

    assert settled is False


@pytest.mark.asyncio
async def test_wait_for_interrupted_runtime_skips_without_interrupt_or_hub() -> None:
    without_interrupt = _FakeManager(
        interrupted=False,
        hub=None,
    )
    without_hub = _FakeManager(interrupted=True, hub=None)

    assert (
        await SessionManager.wait_for_interrupted_runtime(
            without_interrupt,
            "session-a",
            timeout_seconds=0.01,
        )
        is True
    )
    assert (
        await SessionManager.wait_for_interrupted_runtime(
            without_hub,
            "session-a",
            timeout_seconds=0.01,
        )
        is True
    )


def test_interrupted_state_preserves_event_hub_until_finalize_persist() -> None:
    closed = False

    def close_hub() -> None:
        nonlocal closed
        closed = True

    hub = SimpleNamespace(
        is_active=False,
        is_runtime_done=True,
        close=close_hub,
    )
    managed = SimpleNamespace(
        execution_state="running",
        updated_at=0.0,
        event_hub=hub,
    )
    manager = SessionManager.__new__(SessionManager)
    manager._sessions = {"session-a": managed}

    manager.set_execution_state("session-a", "interrupted")

    assert managed.execution_state == "interrupted"
    assert managed.event_hub is hub
    assert closed is False


def test_meta_chat_waits_for_previous_runtime_before_ensure_event_hub() -> None:
    """Regression: barrier must precede ensure_event_hub in /api/chat.

    Creating the new hub first lets the old finalize clear_event_hub close the
    hub this request already holds, so barge-in SSE never delivers.
    """
    from pathlib import Path

    server_src = Path(__file__).resolve().parents[1] / "agenticx" / "studio" / "server.py"
    text = server_src.read_text(encoding="utf-8")
    marker = "event_queue: \"asyncio.Queue[RuntimeEvent | None]\""
    idx = text.find(marker)
    assert idx >= 0, "meta chat event_queue setup block not found"
    window = text[idx : idx + 2500]
    wait_at = window.find("wait_for_interrupted_runtime")
    hub_at = window.find("ensure_event_hub")
    assert wait_at >= 0, "wait_for_interrupted_runtime missing near event_queue setup"
    assert hub_at >= 0, "ensure_event_hub missing near event_queue setup"
    assert wait_at < hub_at, (
        "wait_for_interrupted_runtime must run before ensure_event_hub "
        f"(wait_at={wait_at}, hub_at={hub_at})"
    )
