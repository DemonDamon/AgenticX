#!/usr/bin/env python3
"""Smoke tests for LLM sync-stream watchdog helper.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, List

import pytest

from agenticx.runtime.agent_runtime import (
    _STREAM_WAITING_HINT,
    _StreamWatchdogUserStop,
    _iter_sync_stream_with_watchdog,
)


async def _collect_stream(
    *,
    producer: Callable[[Any, Callable[[Any], None]], None],
    invoke_timeout_seconds: float = 0.2,
    heartbeat_timeout_seconds: float = 0.2,
    hard_timeout_seconds: float = 0.5,
    first_feedback_seconds: float = 0.0,
    emit_waiting_hint: bool = False,
    should_stop: bool = False,
) -> List[Any]:
    stop_flag = {"value": should_stop}

    async def _check_should_stop() -> bool:
        return bool(stop_flag["value"])

    items: List[Any] = []
    loop = asyncio.get_running_loop()
    async for item in _iter_sync_stream_with_watchdog(
        loop=loop,
        run_sync_stream=producer,
        check_should_stop=_check_should_stop,
        invoke_timeout_seconds=invoke_timeout_seconds,
        heartbeat_timeout_seconds=heartbeat_timeout_seconds,
        hard_timeout_seconds=hard_timeout_seconds,
        first_feedback_seconds=first_feedback_seconds,
        emit_waiting_hint=emit_waiting_hint,
        queue_poll_seconds=0.02,
    ):
        items.append(item)
    return items


def _stable_producer(chunks: List[str]) -> Callable[[Any, Callable[[Any], None]], None]:
    def _run(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        for chunk in chunks:
            queue_put(chunk)
        queue_put(None)

    return _run


def test_stable_stream_does_not_timeout() -> None:
    async def _run() -> None:
        items = await _collect_stream(
            producer=_stable_producer(["a", "b", "c"]),
            invoke_timeout_seconds=0.3,
            heartbeat_timeout_seconds=0.3,
            hard_timeout_seconds=1.0,
        )
        assert items == ["a", "b", "c"]

    asyncio.run(_run())


def test_first_byte_invoke_timeout() -> None:
    def _slow_first_byte(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        time.sleep(0.25)
        queue_put("late")
        queue_put(None)

    async def _run() -> None:
        with pytest.raises(asyncio.TimeoutError):
            await _collect_stream(
                producer=_slow_first_byte,
                invoke_timeout_seconds=0.1,
                heartbeat_timeout_seconds=0.2,
                hard_timeout_seconds=1.0,
            )

    asyncio.run(_run())


def test_inter_token_heartbeat_timeout() -> None:
    def _slow_gap(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        queue_put("first")
        time.sleep(0.25)
        queue_put("second")
        queue_put(None)

    async def _run() -> None:
        with pytest.raises(asyncio.TimeoutError):
            await _collect_stream(
                producer=_slow_gap,
                invoke_timeout_seconds=0.2,
                heartbeat_timeout_seconds=0.1,
                hard_timeout_seconds=1.0,
            )

    asyncio.run(_run())


def test_hard_timeout() -> None:
    def _never_end(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        while not _stop_event.is_set():
            queue_put("tick")
            time.sleep(0.05)

    async def _run() -> None:
        with pytest.raises(asyncio.TimeoutError):
            await _collect_stream(
                producer=_never_end,
                invoke_timeout_seconds=0.2,
                heartbeat_timeout_seconds=0.2,
                hard_timeout_seconds=0.15,
            )

    asyncio.run(_run())


def test_stream_error_payload_raises_runtime_error() -> None:
    def _error_producer(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        queue_put({"type": "stream_error", "error": "upstream failed"})
        queue_put(None)

    async def _run() -> None:
        with pytest.raises(RuntimeError, match="upstream failed"):
            await _collect_stream(producer=_error_producer)

    asyncio.run(_run())


def test_user_stop_raises_watchdog_stop() -> None:
    def _slow_producer(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        time.sleep(0.2)
        queue_put("never")

    async def _run() -> None:
        stop_flag = {"value": False}

        async def _check_should_stop() -> bool:
            if not stop_flag["value"]:
                stop_flag["value"] = True
            return stop_flag["value"]

        loop = asyncio.get_running_loop()
        with pytest.raises(_StreamWatchdogUserStop):
            async for _ in _iter_sync_stream_with_watchdog(
                loop=loop,
                run_sync_stream=_slow_producer,
                check_should_stop=_check_should_stop,
                invoke_timeout_seconds=1.0,
                heartbeat_timeout_seconds=1.0,
                hard_timeout_seconds=2.0,
                queue_poll_seconds=0.02,
            ):
                pass

    asyncio.run(_run())


def test_waiting_hint_sentinel() -> None:
    def _slow_first_byte(_stop_event: Any, queue_put: Callable[[Any], None]) -> None:
        time.sleep(0.12)
        queue_put("ok")
        queue_put(None)

    async def _run() -> None:
        items = await _collect_stream(
            producer=_slow_first_byte,
            invoke_timeout_seconds=0.5,
            heartbeat_timeout_seconds=0.5,
            hard_timeout_seconds=1.0,
            first_feedback_seconds=0.05,
            emit_waiting_hint=True,
        )
        assert items[0] is _STREAM_WAITING_HINT
        assert items[1:] == ["ok"]

    asyncio.run(_run())


def test_bare_stream_style_hang_respects_watchdog() -> None:
    """Mimics bare ``llm.stream`` compensation: connected but no first token."""

    def _hang_before_first_token(
        stop_event: Any,
        queue_put: Callable[[Any], None],
    ) -> None:
        while not stop_event.is_set():
            time.sleep(0.02)
        queue_put(None)

    async def _run() -> None:
        with pytest.raises(asyncio.TimeoutError):
            await _collect_stream(
                producer=_hang_before_first_token,
                invoke_timeout_seconds=0.1,
                heartbeat_timeout_seconds=0.2,
                hard_timeout_seconds=1.0,
            )

    asyncio.run(_run())


def test_default_invoke_timeout_is_sixty_seconds() -> None:
    from agenticx.runtime.agent_runtime import DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS

    assert DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS == 60.0
