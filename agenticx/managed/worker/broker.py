#!/usr/bin/env python3
"""Remote action broker and batched event ingest for a desktop worker.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from agenticx.managed.events.adapter import RuntimeEventAdapter
from agenticx.managed.events.state_machine import ActionKind, status_idle_event
from agenticx.managed.protocol import ClientEvent, UserCustomToolResult, UserToolConfirmation
from agenticx.managed.spec import ToolKind, ToolPolicy
from agenticx.managed.worker.client import MAWorkerClient, WorkLeaseLostError

logger = logging.getLogger(__name__)

_MAX_CHUNK = 100
_FLUSH_ATTEMPTS = 4
_FLUSH_DELAY_SECONDS = 1.0


class IngestSink:
    """Buffer server events and POST them in chunks of at most 100."""

    def __init__(
        self,
        client: MAWorkerClient,
        *,
        session_id: str,
        work_id: str,
        device_id: str,
        flush_interval: float = 0.5,
        max_batch: int = 20,
    ) -> None:
        self._client = client
        self._session_id = session_id
        self._work_id = work_id
        self._device_id = device_id
        self._flush_interval = flush_interval
        self._max_batch = max_batch
        self._buffer: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._fatal: BaseException | None = None

    async def start(self) -> None:
        """Start the periodic flush task."""
        self._task = asyncio.create_task(self._periodic(), name="ma-worker-ingest")

    async def emit(
        self,
        events: Sequence[Mapping[str, Any]],
        *,
        flush: bool = False,
    ) -> None:
        if self._fatal is not None:
            raise self._fatal
        async with self._lock:
            self._buffer.extend(dict(event) for event in events)
            should_flush = flush or len(self._buffer) >= self._max_batch
        if should_flush:
            await self.flush()

    async def flush(self) -> None:
        """Send the buffer. ``WorkLeaseLostError`` is not retried."""
        if self._fatal is not None:
            raise self._fatal
        async with self._lock:
            if not self._buffer:
                return
            pending = self._buffer
            self._buffer = []
            sent = 0
            try:
                while sent < len(pending):
                    chunk = pending[sent : sent + _MAX_CHUNK]
                    await self._send_chunk(chunk)
                    sent += len(chunk)
            except BaseException as exc:
                self._buffer = pending[sent:] + self._buffer
                if isinstance(exc, WorkLeaseLostError):
                    self._fatal = exc
                raise

    async def close(self) -> None:
        """Flush once more and cancel the periodic task."""
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.flush()

    async def _periodic(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._flush_interval)
                try:
                    await self.flush()
                except WorkLeaseLostError:
                    return
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("worker ingest flush failed", exc_info=True)
        except asyncio.CancelledError:
            raise

    async def _send_chunk(self, chunk: list[dict[str, Any]]) -> None:
        attempt = 0
        while True:
            try:
                await self._client.ingest(
                    self._session_id,
                    self._work_id,
                    self._device_id,
                    chunk,
                )
                return
            except WorkLeaseLostError:
                raise
            except Exception:
                attempt += 1
                if attempt >= _FLUSH_ATTEMPTS:
                    raise
                await asyncio.sleep(_FLUSH_DELAY_SECONDS)


class RemoteActionBroker:
    """Action broker that parks locally and ships events to the host."""

    def __init__(self, *, sink: IngestSink, adapter: RuntimeEventAdapter) -> None:
        self._sink = sink
        self._adapter = adapter
        self._waiters: dict[str, tuple[ActionKind, asyncio.Future[ClientEvent | None]]] = {}
        self._voided = False

    async def announce_tool_use(
        self,
        *,
        kind: ToolKind,
        name: str,
        input: Mapping[str, Any],
        evaluated_policy: ToolPolicy | None,
        mcp_server: str | None = None,
    ) -> str:
        events = self._adapter.build_tool_use(
            kind=kind,
            name=name,
            input=input,
            evaluated_policy=evaluated_policy,
            mcp_server=mcp_server,
        )
        await self._sink.emit(events, flush=True)
        return str(events[-1]["id"])

    async def request_action(self, event_id: str, kind: ActionKind) -> ClientEvent | None:
        """Emit requires_action and wait. An interrupt resolves the wait with None."""
        if self._voided:
            return None
        loop = asyncio.get_running_loop()
        future: asyncio.Future[ClientEvent | None] = loop.create_future()
        self._waiters[event_id] = (kind, future)
        if self._voided:
            self._waiters.pop(event_id, None)
            return None
        try:
            await self._sink.emit(
                [status_idle_event("requires_action", [event_id])],
                flush=True,
            )
            return await future
        finally:
            self._waiters.pop(event_id, None)

    def custom_tool_use_id(self, name: str) -> str | None:
        return self._adapter.ledger.inflight_custom(name)

    def deliver(self, event: ClientEvent) -> bool:
        """Resolve the waiter with the same id and kind. Unknown ids return False."""
        ref = _resolution_ref(event)
        if ref is None:
            return False
        event_id, kind = ref
        waiter = self._waiters.get(event_id)
        if waiter is None or waiter[0] != kind:
            return False
        future = waiter[1]
        if not future.done():
            future.set_result(event)
        return True

    def void_all(self) -> None:
        """Drop every parked resolution. Later ``request_action`` calls return None."""
        self._voided = True
        for _kind, future in list(self._waiters.values()):
            if not future.done():
                future.set_result(None)

    def reset(self) -> None:
        """Allow a new turn to park for resolutions again."""
        self._voided = False


def _resolution_ref(event: ClientEvent) -> tuple[str, ActionKind] | None:
    if isinstance(event, UserToolConfirmation):
        return event.tool_use_id, "tool_confirmation"
    if isinstance(event, UserCustomToolResult):
        return event.custom_tool_use_id, "custom_tool_result"
    return None


__all__ = [
    "IngestSink",
    "RemoteActionBroker",
]
