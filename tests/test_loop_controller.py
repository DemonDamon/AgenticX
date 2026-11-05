#!/usr/bin/env python3
"""Tests for LoopController."""

from __future__ import annotations

import asyncio

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.loop_controller import LoopController


class _FakeRuntime:
    def __init__(self, final_text: str) -> None:
        self.final_text = final_text

    async def run_turn(self, *_args, **_kwargs):
        yield RuntimeEvent(type=EventType.FINAL.value, data={"text": self.final_text}, agent_id="meta")


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


class _ErrorRuntime:
    def __init__(self, detector: str) -> None:
        self.detector = detector
        self.calls = 0

    async def run_turn(self, *_args, **_kwargs):
        self.calls += 1
        yield RuntimeEvent(
            type=EventType.ERROR.value,
            data={"text": "A safe error", "detector": self.detector},
            agent_id="meta",
        )


def test_loop_controller_stops_after_interrupted_output() -> None:
    runtime = _ErrorRuntime("stream_interrupted")
    controller = LoopController(max_iterations=3)

    async def run():
        return [event async for event in controller.run_loop(task="x", runtime=runtime, session=object())]

    events = asyncio.run(run())

    assert runtime.calls == 1
    assert len(events) == 1
    assert events[-1].data["detector"] == "stream_interrupted"


def test_loop_controller_keeps_iteration_budget_for_other_errors() -> None:
    runtime = _ErrorRuntime("other")
    controller = LoopController(max_iterations=2)

    async def run():
        return [event async for event in controller.run_loop(task="x", runtime=runtime, session=object())]

    events = asyncio.run(run())

    assert runtime.calls == 2
    assert events[-1].data["loop"] == {"completed": False, "max_iterations": 2}
