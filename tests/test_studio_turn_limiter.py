from __future__ import annotations

import asyncio

import pytest

from agenticx.studio.turn_limiter import (
    SessionTurnBusy,
    TurnLimiter,
    TurnQueueFull,
    TurnQueueTimeout,
    stream_with_turn_lease,
)


@pytest.mark.asyncio
async def test_fifo_waiter_enters_only_after_release() -> None:
    limiter = TurnLimiter(max_active=2, max_waiters=2, wait_timeout_seconds=1)
    first = await limiter.acquire("s1", source="chat")
    second = await limiter.acquire("s2", source="chat")
    waiting = asyncio.create_task(limiter.acquire("s3", source="automation"))
    await asyncio.sleep(0)

    assert limiter.active_count == 2
    assert limiter.waiting_count == 1
    assert not waiting.done()

    await first.release()
    third = await asyncio.wait_for(waiting, timeout=0.2)
    assert limiter.active_count == 2
    assert limiter.waiting_count == 0

    await second.release()
    await third.release()
    assert limiter.active_count == 0


@pytest.mark.asyncio
async def test_session_is_single_flight_while_active_or_waiting() -> None:
    limiter = TurnLimiter(max_active=1, max_waiters=2, wait_timeout_seconds=1)
    active = await limiter.acquire("active", source="chat")
    with pytest.raises(SessionTurnBusy):
        await limiter.acquire("active", source="loop")

    waiting = asyncio.create_task(limiter.acquire("queued", source="chat"))
    await asyncio.sleep(0)
    with pytest.raises(SessionTurnBusy):
        await limiter.acquire("queued", source="continue")

    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    await active.release()


@pytest.mark.asyncio
async def test_queue_full_timeout_and_cancel_do_not_reserve_session() -> None:
    limiter = TurnLimiter(max_active=1, max_waiters=1, wait_timeout_seconds=0.01)
    active = await limiter.acquire("active", source="chat")
    timeout_task = asyncio.create_task(limiter.acquire("timeout", source="chat"))
    await asyncio.sleep(0)
    with pytest.raises(TurnQueueFull):
        await limiter.acquire("overflow", source="chat")
    with pytest.raises(TurnQueueTimeout):
        await timeout_task

    retry = asyncio.create_task(limiter.acquire("timeout", source="chat"))
    await asyncio.sleep(0)
    retry.cancel()
    with pytest.raises(asyncio.CancelledError):
        await retry
    assert limiter.waiting_count == 0

    await active.release()
    recovered = await limiter.acquire("timeout", source="chat")
    await recovered.release()


@pytest.mark.asyncio
async def test_release_is_idempotent_and_stale_lease_cannot_release_new_turn() -> None:
    limiter = TurnLimiter(max_active=1, max_waiters=1, wait_timeout_seconds=1)
    first = await limiter.acquire("same", source="chat")
    await first.release()
    await first.release()

    second = await limiter.acquire("same", source="chat")
    await first._limiter._release(first.session_id, first.lease_id)
    assert limiter.active_count == 1
    await second.release()
    assert limiter.active_count == 0


def test_environment_values_fall_back_and_clamp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_DESKTOP_MAX_CONCURRENT_TURNS", "not-a-number")
    monkeypatch.setenv("AGX_DESKTOP_MAX_QUEUED_TURNS", "999")
    monkeypatch.setenv("AGX_DESKTOP_TURN_QUEUE_TIMEOUT_SECONDS", "0")
    limiter = TurnLimiter.from_env()
    assert limiter.max_active == 3
    assert limiter.max_waiters == 256
    assert limiter.wait_timeout_seconds == 1.0


@pytest.mark.asyncio
async def test_stream_holds_lease_until_eof_and_releases_on_error_or_cancel() -> None:
    limiter = TurnLimiter(max_active=3, max_waiters=0)

    async def two_chunks():
        yield b"one"
        yield b"two"

    eof_lease = await limiter.acquire("eof", source="chat")
    wrapped = stream_with_turn_lease(two_chunks(), eof_lease)
    assert await anext(wrapped) == b"one"
    assert limiter.active_count == 1
    assert await anext(wrapped) == b"two"
    with pytest.raises(StopAsyncIteration):
        await anext(wrapped)
    assert limiter.active_count == 0

    async def broken():
        yield b"before-error"
        raise RuntimeError("boom")

    error_lease = await limiter.acquire("error", source="chat")
    broken_stream = stream_with_turn_lease(broken(), error_lease)
    assert await anext(broken_stream) == b"before-error"
    with pytest.raises(RuntimeError, match="boom"):
        await anext(broken_stream)
    assert limiter.active_count == 0

    cancel_lease = await limiter.acquire("cancel", source="chat")
    cancelled_stream = stream_with_turn_lease(two_chunks(), cancel_lease)
    assert await anext(cancelled_stream) == b"one"
    await cancelled_stream.aclose()
    assert limiter.active_count == 0
