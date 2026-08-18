#!/usr/bin/env python3
"""Tests for LoopController."""

from __future__ import annotations

import asyncio

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.loop_controller import LoopController


class _FakeRuntime:
    def __init__(self, final_text: str) -> None:
        self.final_text = final_text
        self.history_metadata = []

    async def run_turn(self, *_args, **_kwargs):
        self.history_metadata.append(_kwargs.get("history_user_metadata"))
        yield RuntimeEvent(type=EventType.FINAL.value, data={"text": self.final_text}, agent_id="meta")


class _BudgetBlockedRuntime:
    def __init__(self) -> None:
        self.calls = 0

    async def run_turn(self, *_args, **_kwargs):
        self.calls += 1
        yield RuntimeEvent(
            type=EventType.ERROR.value,
            data={
                "detector": "token_budget",
                "budget_exceeded": True,
                "budget_source": "turn",
            },
            agent_id="meta",
        )


def test_loop_controller_stops_on_completion_promise() -> None:
    controller = LoopController(max_iterations=5, completion_promise="DONE")
    runtime = _FakeRuntime("任务完成 <promise>DONE</promise>")

    async def _run():
        events = []
        async for event in controller.run_loop(task="x", runtime=runtime, session=object()):
            events.append(event)
        return events

    events = asyncio.run(_run())
    assert events
    assert any(event.type == EventType.FINAL.value for event in events)


def test_loop_controller_errors_on_max_iterations() -> None:
    controller = LoopController(max_iterations=2, completion_promise="NEVER")
    runtime = _FakeRuntime("still running")

    async def _run():
        last = None
        async for event in controller.run_loop(task="x", runtime=runtime, session=object()):
            last = event
        return last

    last = asyncio.run(_run())
    assert last is not None
    assert last.type == EventType.ERROR.value


def test_loop_controller_passes_one_task_id_to_every_iteration() -> None:
    controller = LoopController(max_iterations=2, completion_promise="NEVER")
    runtime = _FakeRuntime("still running")

    async def _run():
        async for _event in controller.run_loop(
            task="x",
            runtime=runtime,
            session=object(),
            history_user_metadata={"client_turn_id": "loop-turn-9"},
        ):
            pass

    asyncio.run(_run())
    assert runtime.history_metadata == [
        {"client_turn_id": "loop-turn-9"},
        {"client_turn_id": "loop-turn-9"},
    ]


def test_loop_controller_stops_after_explicit_turn_budget_limit() -> None:
    controller = LoopController(max_iterations=5, completion_promise="NEVER")
    runtime = _BudgetBlockedRuntime()

    async def _run():
        events = []
        async for event in controller.run_loop(task="x", runtime=runtime, session=object()):
            events.append(event)
        return events

    events = asyncio.run(_run())
    assert runtime.calls == 1
    assert len(events) == 1
    assert events[0].type == EventType.ERROR.value
    assert events[0].data["budget_exceeded"] is True
