#!/usr/bin/env python3
"""Desktop worker loop: claim a work item and run AgentRuntime locally.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from agenticx.managed.actions import CustomToolResolver
from agenticx.managed.builder import (
    ManagedAgentBuilder,
    ManagedRuntimeBundle,
    rehydrate_agent_messages,
)
from agenticx.managed.errors import MAError
from agenticx.managed.events import RuntimeEventAdapter, session_error_event
from agenticx.managed.events.state_machine import status_idle_event, status_running_event
from agenticx.managed.host.actor import content_to_model_text
from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.permissions import (
    ManagedConfirmGate,
    ManagedPermissionHook,
    PermissionEngine,
    ToolAuthorization,
)
from agenticx.managed.protocol import (
    WORK_HEARTBEAT_INTERVAL_SECONDS,
    WORK_POLL_MAX_WAIT_SECONDS,
    Usage,
    parse_client_events,
)
from agenticx.managed.spec import compile_spec
from agenticx.managed.worker.broker import IngestSink, RemoteActionBroker
from agenticx.managed.worker.client import (
    MAWorkerClient,
    MAWorkerError,
    WorkAssignment,
    WorkLeaseLostError,
)
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy

logger = logging.getLogger(__name__)

IDLE_COMPLETE_SECONDS = 2.0
_HISTORY_TYPES = ("user.message", "agent.message")


@dataclass
class _RunState:
    turn_running: bool = False
    stop_requested: bool = False
    lease_lost: bool = False
    last_inbox_seq: int = 0
    usage: Usage | None = None
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)


class WorkItemRunner:
    """Run one claimed work item on this machine and report the result."""

    def __init__(
        self,
        *,
        client: MAWorkerClient,
        device_id: str,
        llm_factory: LLMFactory,
        workdir_root: Path,
        enterprise_policy_loader: Callable[[], EnterpriseAgentPolicy] = EnterpriseAgentPolicy,
        heartbeat_interval: float = float(WORK_HEARTBEAT_INTERVAL_SECONDS),
        idle_complete_seconds: float = IDLE_COMPLETE_SECONDS,
    ) -> None:
        self._client = client
        self._device_id = device_id
        self._llm_factory = llm_factory
        self._workdir_root = workdir_root
        self._policy_loader = enterprise_policy_loader
        self._heartbeat_interval = heartbeat_interval
        self._idle_complete_seconds = idle_complete_seconds

    async def run(self, assignment: WorkAssignment) -> None:
        work_id = assignment.work.id
        await self._client.ack(work_id, self._device_id)
        try:
            await self._run_acked(assignment)
        except asyncio.CancelledError:
            raise
        except WorkLeaseLostError:
            return
        except Exception as exc:
            logger.warning("worker failed work %s", work_id, exc_info=True)
            try:
                await self._client.fail(
                    work_id,
                    self._device_id,
                    f"{type(exc).__name__}: {exc}"[:500],
                )
            except Exception:
                logger.warning("worker fail report failed work %s", work_id, exc_info=True)

    async def _run_acked(self, assignment: WorkAssignment) -> None:
        work_id = assignment.work.id
        session_id = assignment.session.id
        try:
            spec = compile_spec(assignment.agent_id, assignment.agent_version, assignment.manifest)
        except MAError as err:
            errors = err.details.get("errors", []) if isinstance(err.details, dict) else []
            detail = "; ".join(str(item) for item in errors)
            await self._client.fail(
                work_id,
                self._device_id,
                "manifest invalid: " + detail,
            )
            return
        history = await _history(self._client, session_id, assignment.inbox_after_seq)
        adapter = RuntimeEventAdapter(model_ref=spec.model_ref, kind_of=spec.kind_of)
        sink = IngestSink(
            self._client,
            session_id=session_id,
            work_id=work_id,
            device_id=self._device_id,
        )
        await sink.start()
        broker = RemoteActionBroker(sink=sink, adapter=adapter)
        state = _RunState(last_inbox_seq=assignment.inbox_after_seq)
        tasks: list[asyncio.Task[None]] = []
        try:
            auth = ToolAuthorization()
            engine = PermissionEngine(spec, self._policy_loader())
            bundle = ManagedAgentBuilder(
                llm_factory=self._llm_factory,
                workdir_root=self._workdir_root,
            ).build(
                spec,
                context=LLMCallContext(
                    tenant_id=assignment.session.tenant_id,
                    session_id=session_id,
                    agent_id=assignment.agent_id,
                    agent_version=assignment.agent_version,
                    user_id=assignment.session.created_by_user_id,
                ),
                confirm_gate=ManagedConfirmGate(auth),
                hooks=[
                    ManagedPermissionHook(
                        engine=engine,
                        broker=broker,
                        authorization=auth,
                    )
                ],
                custom_tool_resolver=CustomToolResolver(
                    broker=broker,
                    custom_tool_names=spec.custom_tool_names,
                ),
                history=rehydrate_agent_messages(history),
            )
            tasks.append(
                asyncio.create_task(
                    self._heartbeat_loop(work_id, state, broker),
                    name=f"ma-heartbeat-{work_id}",
                )
            )
            tasks.append(
                asyncio.create_task(
                    self._inbox_loop(session_id, work_id, state, broker),
                    name=f"ma-inbox-{work_id}",
                )
            )
            usage = assignment.session.usage
            while not state.lease_lost:
                try:
                    message = await asyncio.wait_for(
                        state.queue.get(),
                        timeout=self._idle_complete_seconds,
                    )
                except TimeoutError:
                    break
                if state.lease_lost or message.get("type") != "user.message":
                    break
                await self._run_turn(
                    message,
                    state=state,
                    broker=broker,
                    adapter=adapter,
                    sink=sink,
                    bundle=bundle,
                    usage=usage,
                )
                usage = state.usage if state.usage is not None else usage
                if state.lease_lost:
                    break
        except WorkLeaseLostError:
            state.lease_lost = True
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.warning("worker side task failed", exc_info=True)
            if not state.lease_lost:
                await sink.close()
        if state.lease_lost:
            return
        await self._client.complete(
            work_id,
            self._device_id,
            consumed_through_seq=state.last_inbox_seq,
        )

    async def _run_turn(
        self,
        message: dict[str, object],
        *,
        state: _RunState,
        broker: RemoteActionBroker,
        adapter: RuntimeEventAdapter,
        sink: IngestSink,
        bundle: ManagedRuntimeBundle,
        usage: Usage,
    ) -> None:
        raw_content = message.get("content") or []
        blocks = (
            [item for item in raw_content if isinstance(item, Mapping)]
            if isinstance(raw_content, list)
            else []
        )
        text, unsupported = content_to_model_text(blocks)
        state.stop_requested = False
        state.turn_running = True
        broker.reset()
        try:
            await sink.emit([status_running_event()], flush=True)
            if unsupported:
                await sink.emit(
                    [
                        session_error_event(
                            "unsupported_content",
                            "image and file content blocks are ignored by this worker",
                            "exhausted",
                        )
                    ]
                )
            adapter.begin_turn(usage)
            try:
                async for event in bundle.run_turn(
                    text,
                    should_stop=lambda: state.stop_requested,
                ):
                    output = adapter.convert(event)
                    if output.events:
                        await sink.emit(output.events)
                outcome = adapter.finish_turn()
            except WorkLeaseLostError:
                state.lease_lost = True
                return
            except Exception as exc:
                outcome = adapter.finish_turn(error=exc)
            state.usage = outcome.usage
            await sink.emit(
                [*outcome.events, status_idle_event(outcome.stop_type)],
                flush=True,
            )
        finally:
            state.turn_running = False

    async def _heartbeat_loop(
        self,
        work_id: str,
        state: _RunState,
        broker: RemoteActionBroker,
    ) -> None:
        while not state.lease_lost:
            await asyncio.sleep(self._heartbeat_interval)
            if state.lease_lost:
                return
            try:
                await self._client.heartbeat(work_id, self._device_id)
            except WorkLeaseLostError:
                _mark_lost(state, broker)
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("worker heartbeat failed", exc_info=True)

    async def _inbox_loop(
        self,
        session_id: str,
        work_id: str,
        state: _RunState,
        broker: RemoteActionBroker,
    ) -> None:
        while not state.lease_lost:
            try:
                async for event in self._client.inbox(
                    session_id,
                    work_id,
                    self._device_id,
                    after_seq=state.last_inbox_seq,
                ):
                    seq = event.get("seq")
                    if isinstance(seq, int):
                        state.last_inbox_seq = max(state.last_inbox_seq, seq)
                    event_type = event.get("type")
                    if event_type == "user.message":
                        await state.queue.put(event)
                    elif event_type in {"user.tool_confirmation", "user.custom_tool_result"}:
                        try:
                            parsed = parse_client_events({"events": [event]})[0]
                        except MAError:
                            logger.warning("worker ignored invalid inbox resolution")
                            continue
                        broker.deliver(parsed)
                    elif event_type == "user.interrupt" and state.turn_running:
                        state.stop_requested = True
                        broker.void_all()
            except WorkLeaseLostError:
                _mark_lost(state, broker)
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("worker inbox stream failed", exc_info=True)
            if state.lease_lost:
                return
            await asyncio.sleep(1.0)


class MAWorker:
    """Poll one or more desktop-worker environments and run claimed items."""

    def __init__(
        self,
        *,
        client: MAWorkerClient,
        environment_ids: Sequence[str],
        device_id: str,
        runner: WorkItemRunner,
    ) -> None:
        self._client = client
        self._environment_ids = list(environment_ids)
        self._device_id = device_id
        self._runner = runner

    async def run_once(self, *, max_wait_seconds: int = 0) -> bool:
        """Run the first assignment found. ``WorkerAuthError`` propagates."""
        for environment_id in self._environment_ids:
            assignment = await self._client.poll(
                environment_id,
                self._device_id,
                max_wait_seconds=max_wait_seconds,
            )
            if assignment is None:
                continue
            await self._runner.run(assignment)
            return True
        return False

    async def run_forever(self, *, stop: asyncio.Event | None = None) -> None:
        """Poll until ``stop`` is set. Auth and network errors back off briefly."""
        while stop is None or not stop.is_set():
            try:
                await self.run_once(max_wait_seconds=WORK_POLL_MAX_WAIT_SECONDS)
            except MAWorkerError as exc:
                logger.warning("worker poll failed: %s", exc)
                await asyncio.sleep(3)
            except (httpx.HTTPError, OSError) as exc:
                logger.warning("worker network error: %s", exc)
                await asyncio.sleep(3)
            if stop is not None and stop.is_set():
                return


def _mark_lost(state: _RunState, broker: RemoteActionBroker) -> None:
    state.lease_lost = True
    state.stop_requested = True
    broker.void_all()
    state.queue.put_nowait({"type": "_stop"})


async def _history(
    client: MAWorkerClient,
    session_id: str,
    inbox_after_seq: int,
) -> list[dict[str, Any]]:
    cursor = 0
    history: list[dict[str, Any]] = []
    while True:
        rows, has_more = await client.list_events(
            session_id,
            after_seq=cursor,
            limit=500,
            types=list(_HISTORY_TYPES),
        )
        if not rows:
            break
        for row in rows:
            seq = row.get("seq")
            if not isinstance(seq, int):
                continue
            cursor = seq
            if seq <= inbox_after_seq:
                history.append(row)
        if not has_more or cursor >= inbox_after_seq:
            break
    return history


__all__ = [
    "IDLE_COMPLETE_SECONDS",
    "MAWorker",
    "WorkItemRunner",
]
