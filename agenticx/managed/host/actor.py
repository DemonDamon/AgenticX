#!/usr/bin/env python3
"""Per-session actor and the in-process cloud turn executor.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from agenticx.managed.actions import CustomToolResolver
from agenticx.managed.builder import rehydrate_agent_messages
from agenticx.managed.events import (
    EventLog,
    InterruptTurn,
    ResolveActions,
    RuntimeEventAdapter,
    SubmitMessage,
    session_error_event,
)
from agenticx.managed.events.adapter import TurnOutcome
from agenticx.managed.events.state_machine import ActionKind, PendingAction, SessionStateMachine
from agenticx.managed.errors import INVALID_EVENT_BATCH, MAError
from agenticx.managed.events.store import StoredEvent, ThreadFilter
from agenticx.managed.extensions import (
    CompositeToolResolver,
    DynamicHook,
    DynamicToolResolver,
    SessionExtension,
    TurnContribution,
    TurnSetupError,
)
from agenticx.managed.host.continuation import TurnContinuation, WakeUp, wake_text
from agenticx.managed.host.platform_tools import PlatformToolResolver
from agenticx.managed.host.tasks import TASK_TOOL_NAMES, SessionTaskManager
from agenticx.managed.host.threads import THREAD_TOOL_NAMES, ThreadManager
from agenticx.managed.ids import utc_now_iso
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.permissions import (
    ManagedConfirmGate,
    ManagedPermissionHook,
    PermissionEngine,
    ToolAuthorization,
)
from agenticx.managed.protocol import (
    ClientEvent,
    EnvironmentRecord,
    SessionRecord,
    Usage,
    UserInterrupt,
    event_to_wire,
    parse_client_events,
)
from agenticx.managed.redaction import SecretRedactor, StreamRedactor
from agenticx.managed.spec import AgentSpec, ToolKind, ToolPolicy
from agenticx.runtime.session_boundary import bind_egress_guard, unbind_egress_guard
logger = logging.getLogger(__name__)

_CLIENT_ENVELOPE = frozenset({"id", "session_id", "seq", "created_at", "processed_at"})


class TurnExecutor(Protocol):
    """Runs accepted user messages for one environment type."""

    async def submit_message(self, message: StoredEvent) -> None:
        """Called with the actor lock held, once per accepted user.message."""
        ...

    async def on_resolved(self, resolutions: Mapping[str, ClientEvent]) -> None:
        """Called with the actor lock held after a requires_action batch completes."""
        ...

    async def interrupt(self, dropped_pending: Sequence[str]) -> None:
        """Called with the actor lock held for every InterruptTurn effect."""
        ...

    async def close(self) -> None:
        """Cancel the in-flight turn and drop queued messages."""
        ...


def _strip_envelope(event: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if key not in _CLIENT_ENVELOPE}


def content_to_model_text(content: Sequence[Mapping[str, Any]]) -> tuple[str, bool]:
    """Flatten wire content blocks into model text.

    Returns ``(text, had_unsupported_blocks)``. Image blocks and document
    blocks whose source is a file are unsupported and omitted. MA-A05 reuses
    this helper on the desktop worker.
    """
    parts: list[str] = []
    unsupported = False
    if isinstance(content, (str, bytes)) or not isinstance(content, Sequence):
        return "", False
    for block in content:
        if not isinstance(block, Mapping):
            continue
        kind = block.get("type")
        if kind == "text":
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
            continue
        if kind == "image":
            unsupported = True
            continue
        if kind != "document":
            continue
        source = block.get("source")
        source_type = source.get("type") if isinstance(source, Mapping) else None
        if source_type == "text":
            title = block.get("title")
            body = source.get("text") if isinstance(source, Mapping) else ""
            body_text = body if isinstance(body, str) else ""
            header = "[document]" if title is None else f"[document: {title}]"
            parts.append(f"{header}\n{body_text}")
            continue
        if source_type == "file":
            unsupported = True
    return "\n\n".join(parts), unsupported


def message_text(message: StoredEvent) -> tuple[str, bool]:
    """``content_to_model_text`` of a stored ``user.message`` payload."""
    content = message.payload.get("content") or []
    if not isinstance(content, Sequence) or isinstance(content, (str, bytes)):
        return "", False
    blocks = [block for block in content if isinstance(block, Mapping)]
    return content_to_model_text(blocks)


class SessionActor:
    """One session's state machine, event log, and action broker.

    The same ``SessionStateMachine`` is kept for the life of the actor.
    ``commit`` only returns a ``session.status_running`` event when a
    requires_action batch is fully resolved; callers read ``sm.status`` and
    write it themselves. ``finish_turn`` on the adapter does not emit
    ``session.status_idle``; ``finish_turn_locked`` appends that event.
    """

    def __init__(
        self,
        *,
        service: Any,
        record: SessionRecord,
        spec: AgentSpec,
        environment: EnvironmentRecord,
        sm: SessionStateMachine,
    ) -> None:
        self.service = service
        self.record = record
        self.spec = spec
        self.environment = environment
        self.sm = sm
        self.tenant_id = record.tenant_id
        self.session_id = record.id
        self.lock = asyncio.Lock()
        self.adapter = RuntimeEventAdapter(model_ref=spec.model_ref, kind_of=spec.kind_of)
        self.executor: TurnExecutor
        self._waiters: dict[str, asyncio.Future[ClientEvent | None]] = {}
        self._voided = False
        self.extensions: list[SessionExtension] = []
        self.redactor: SecretRedactor | None = None
        self.threads: ThreadManager | None = None

    @property
    def event_log(self) -> EventLog:
        return self.service.event_log

    async def append(self, events: Sequence[Mapping[str, Any]]) -> list[StoredEvent]:
        if self.redactor is not None and not self.redactor.empty:
            events = [self.redactor.redact_obj(dict(event)) for event in events]
        return await self.event_log.append(self.tenant_id, self.session_id, events)

    async def sync_record(self, *, usage: Usage | None = None) -> None:
        """Persist ``sm.status`` / ``sm.stop_reason``. Models are dumped to dicts."""
        changes: dict[str, Any] = {
            "status": self.sm.status,
            "stop_reason": (
                self.sm.stop_reason.model_dump(mode="json") if self.sm.stop_reason else None
            ),
        }
        if usage is not None:
            changes["usage"] = usage.model_dump(mode="json")
        self.record = await self.service.store.update_session(
            self.tenant_id,
            self.session_id,
            changes,
        )

    def merge_thread_usage(self, outcome: TurnOutcome) -> TurnOutcome:
        """Add the member/advisor usage delta to the outcome and to its trailing session.usage event."""
        delta = self.threads.take_usage_delta() if self.threads is not None else Usage()
        if (
            delta.input_tokens == 0
            and delta.output_tokens == 0
            and delta.cache_read_input_tokens == 0
            and delta.tool_calls == 0
            and delta.runtime_ms == 0
        ):
            return outcome
        usage = Usage(
            input_tokens=outcome.usage.input_tokens + delta.input_tokens,
            output_tokens=outcome.usage.output_tokens + delta.output_tokens,
            cache_read_input_tokens=outcome.usage.cache_read_input_tokens + delta.cache_read_input_tokens,
            tool_calls=outcome.usage.tool_calls + delta.tool_calls,
            runtime_ms=outcome.usage.runtime_ms + delta.runtime_ms,
        )
        events = [dict(event) for event in outcome.events]
        for index in range(len(events) - 1, -1, -1):
            if events[index].get("type") == "session.usage":
                events[index] = {**events[index], "usage": usage.model_dump()}
                break
        return TurnOutcome(stop_type=outcome.stop_type, events=events, usage=usage)

    async def handle_client_batch(self, raw: Any) -> list[StoredEvent]:
        """Validate, persist, and apply one client batch. Failures write nothing."""
        events = parse_client_events(raw)
        if self.threads is not None and any(getattr(event, "thread_id", None) for event in events):
            if not self.threads._loaded:
                await self.threads.load()
        for index, event in enumerate(events):
            tid = getattr(event, "thread_id", None)
            if tid is None:
                continue
            if not isinstance(event, UserInterrupt):
                raise MAError(
                    INVALID_EVENT_BATCH,
                    f"events[{index}]: only user.interrupt may target a thread",
                    details={"index": index},
                )
            if self.threads is None or tid == self.session_id or not self.threads.known_thread(tid):
                raise MAError(
                    INVALID_EVENT_BATCH,
                    f"events[{index}]: unknown thread",
                    details={"index": index},
                )
        async with self.lock:
            ref_ids: list[str] = []
            for event in events:
                if event.type == "user.tool_confirmation":
                    ref_ids.append(event.tool_use_id)
                elif event.type == "user.custom_tool_result":
                    ref_ids.append(event.custom_tool_use_id)
            known: dict[str, str] = {}
            for ref_id in ref_ids:
                stored_ref = await self.service.store.get_event(
                    self.tenant_id,
                    self.session_id,
                    ref_id,
                )
                if stored_ref is not None:
                    known[ref_id] = stored_ref.type
            plan = self.sm.plan_client_events(events, known)
            wire = [_strip_envelope(event_to_wire(event)) for event in plan.events]
            stored = await self.append(wire)
            server_events = self.sm.commit(plan)
            if server_events:
                await self.append(server_events)
            await self.sync_record()
            now = utc_now_iso()
            non_message_ids = [item.id for item in stored if item.type != "user.message"]
            if non_message_ids:
                await self.service.store.mark_processed(
                    self.tenant_id,
                    self.session_id,
                    non_message_ids,
                    now,
                )
            for effect in plan.effects:
                if isinstance(effect, SubmitMessage):
                    await self.executor.submit_message(stored[effect.index])
                elif isinstance(effect, ResolveActions):
                    await self.executor.on_resolved(effect.resolutions)
                elif isinstance(effect, InterruptTurn):
                    if effect.thread_id is not None and self.threads is not None:
                        await self.threads.interrupt_thread(effect.thread_id)
                    else:
                        await self.executor.interrupt(effect.dropped_pending)
        return stored

    async def begin_turn_locked(self) -> None:
        await self.append(self.sm.turn_started())
        await self.sync_record()

    async def finish_turn_locked(self, outcome: TurnOutcome) -> None:
        """Persist adapter terminal events, then the status_idle from the state machine."""
        await self.append(outcome.events)
        await self.append(self.sm.turn_finished(outcome.stop_type))
        await self.sync_record(usage=outcome.usage)

    def resolve_waiters(self, resolutions: Mapping[str, ClientEvent]) -> None:
        for event_id, event in resolutions.items():
            fut = self._waiters.get(event_id)
            if fut is not None and not fut.done():
                fut.set_result(event)

    def void_waiters(self) -> None:
        self._voided = True
        for fut in list(self._waiters.values()):
            if not fut.done():
                fut.set_result(None)

    def reset_waiters(self) -> None:
        self._voided = False

    async def announce_tool_use(
        self,
        *,
        kind: ToolKind,
        name: str,
        input: Mapping[str, Any],
        evaluated_policy: ToolPolicy | None,
        mcp_server: str | None = None,
        ledger_name: str | None = None,
    ) -> str:
        """Persist a hook-announced tool use. Does not take the session lock."""
        events = self.adapter.build_tool_use(
            kind=kind,
            name=name,
            input=input,
            evaluated_policy=evaluated_policy,
            mcp_server=mcp_server,
            ledger_name=ledger_name,
        )
        await self.append(events)
        return str(events[-1]["id"])

    async def request_action(self, event_id: str, kind: ActionKind) -> ClientEvent | None:
        """Park until the matching resolution arrives, or interrupt voids the wait."""
        loop = asyncio.get_running_loop()
        async with self.lock:
            if self._voided:
                return None
            events = self.sm.action_required([PendingAction(event_id, kind)])
            fut: asyncio.Future[ClientEvent | None] = loop.create_future()
            self._waiters[event_id] = fut
            await self.append(events)
            await self.sync_record()
        try:
            return await fut
        finally:
            self._waiters.pop(event_id, None)

    def custom_tool_use_id(self, name: str) -> str | None:
        return self.adapter.ledger.inflight_custom(name)


class LocalTurnExecutor:
    """Cloud environment: run ``AgentRuntime`` inside the host process.

    Custom tools are announced by converting the runtime ``TOOL_CALL`` before
    the next runtime event is pulled. The runtime yields that event and only
    then schedules tool dispatch, so ``convert`` must stay at the top of the
    loop body, before any await that would resume the generator.
    """

    def __init__(self, actor: SessionActor) -> None:
        self.actor = actor
        self._queue: deque[StoredEvent] = deque()
        self._task: asyncio.Task[None] | None = None
        self._stop_requested = False
        self._bundle: Any = None
        self._grace_task: asyncio.Task[None] | None = None
        self._dynamic_resolver = DynamicToolResolver()
        self._dynamic_hook = DynamicHook()
        self._base_tools: list[dict[str, Any]] | None = None
        self._base_system_prompt: str | None = None
        self._extensions_ready = False
        cfg = actor.service.config
        self.continuation: TurnContinuation | None = None
        self.tasks: SessionTaskManager | None = None
        self.platform: PlatformToolResolver | None = None
        self._interrupt_cancels: list[asyncio.Task[None]] = []
        tasks_on = getattr(cfg, "tasks_enabled", False) and actor.environment.type == "cloud"
        wants_threads = actor.spec.multiagent is not None and getattr(cfg, "threads_enabled", False)
        if (tasks_on or wants_threads) and actor.environment.type == "cloud":
            self.continuation = TurnContinuation()
        if tasks_on:
            self.tasks = SessionTaskManager(
                actor=actor,
                continuation=self.continuation,
                foreground_seconds=cfg.task_foreground_seconds,
                max_runtime_seconds=cfg.task_max_runtime_seconds,
                max_running=cfg.max_running_tasks,
            )
        if wants_threads and self.continuation is not None:
            actor.threads = ThreadManager(actor=actor, continuation=self.continuation)

    async def submit_message(self, message: StoredEvent) -> None:
        if self._task is None or self._task.done():
            await self._start_locked(message)
            return
        self._queue.append(message)
        if self.continuation is not None:
            self.continuation.poke()

    async def _start_locked(self, message: StoredEvent) -> None:
        await self.actor.begin_turn_locked()
        await self.actor.service.store.mark_processed(
            self.actor.tenant_id,
            self.actor.session_id,
            [message.id],
            utc_now_iso(),
        )
        self._stop_requested = False
        if self.continuation is not None:
            self.continuation.reopen()
        if self.actor.threads is not None:
            self.actor.threads.resume_reports()
        self.actor.reset_waiters()
        self._task = asyncio.create_task(
            self._run(message),
            name=f"ma-turn-{self.actor.session_id}",
        )

    async def _ensure_bundle(self, before_seq: int) -> Any:
        if self._bundle is not None:
            return self._bundle
        actor = self.actor
        store = actor.service.store
        prior: list[dict[str, Any]] = []
        cursor = 0
        while True:
            rows = await store.list_events(
                actor.tenant_id,
                actor.session_id,
                after_seq=cursor,
                limit=500,
                types=["user.message", "agent.message"],
                thread_filter=ThreadFilter("thread", None),
            )
            prior.extend(row.to_wire() for row in rows if row.seq < before_seq)
            if len(rows) < 500:
                break
            cursor = rows[-1].seq
        auth = ToolAuthorization()
        platform_names: set[str] = set(TASK_TOOL_NAMES) if self.tasks is not None else set()
        multiagent = actor.spec.multiagent
        if actor.threads is not None and isinstance(multiagent, Mapping):
            platform_names.update(THREAD_TOOL_NAMES)
            members = multiagent.get("agents") or []
            if any(isinstance(item, Mapping) and item.get("type") == "advisor" for item in members):
                platform_names.add("advisor")
        engine = PermissionEngine(
            actor.spec,
            actor.service.config.enterprise_policy,
            platform_tools=frozenset(platform_names),
        )
        hook = ManagedPermissionHook(
            engine=engine,
            broker=actor,
            authorization=auth,
            mcp_router_getter=self._current_mcp_router,
        )
        resolver = CustomToolResolver(
            broker=actor,
            custom_tool_names=actor.spec.custom_tool_names,
        )
        self.platform = PlatformToolResolver(resolver)
        context = LLMCallContext(
            tenant_id=actor.tenant_id,
            session_id=actor.session_id,
            agent_id=actor.record.agent_id,
            agent_version=actor.record.agent_version,
            user_id=actor.record.created_by_user_id,
        )
        self._bundle = actor.service.builder.build(
            actor.spec,
            context=context,
            confirm_gate=ManagedConfirmGate(auth),
            hooks=[hook, self._dynamic_hook],
            custom_tool_resolver=CompositeToolResolver([self.platform, self._dynamic_resolver]),
            history=rehydrate_agent_messages(prior),
        )
        if self.tasks is not None:
            self.tasks.install(self._bundle, self.platform)
        if self.actor.threads is not None:
            await self.actor.threads.load()
            self.actor.threads.install(self.platform, primary_bundle_getter=lambda: self._bundle)
        self._bundle.tools.extend(self.platform.schemas())
        self._base_tools = list(self._bundle.tools)
        self._base_system_prompt = self._bundle.system_prompt
        if not self._extensions_ready:
            for factory in actor.service.extension_factories:
                extension = await factory(actor)
                if extension is not None:
                    actor.extensions.append(extension)
            self._extensions_ready = True
        return self._bundle

    def _current_mcp_router(self) -> Any:
        for extension in self.actor.extensions:
            router = getattr(extension, "current_router", None)
            if router is not None:
                return router
        return None

    async def _before_turn(self, bundle: Any) -> TurnContribution:
        merged = TurnContribution()
        for extension in self.actor.extensions:
            part = await extension.before_turn(bundle)
            merged.hooks.extend(part.hooks)
            merged.tool_schemas.extend(part.tool_schemas)
            merged.resolvers.extend(part.resolvers)
            if part.system_prompt_suffix:
                merged.system_prompt_suffix += "\n" + part.system_prompt_suffix
            merged.command_env.update(part.command_env)
            if part.command_network == "deny":
                merged.command_network = "deny"
            if part.egress_guard is not None:
                merged.egress_guard = part.egress_guard
            if part.redactor is not None:
                merged.redactor = part.redactor
            merged.events.extend(part.events)
        bundle.tools[:] = list(self._base_tools or []) + merged.tool_schemas
        bundle.system_prompt = (self._base_system_prompt or "") + merged.system_prompt_suffix
        bundle.session.managed_command_env = dict(merged.command_env)
        bundle.session.managed_command_network = merged.command_network
        self._dynamic_resolver.set(merged.resolvers)
        self._dynamic_hook.set(merged.hooks)
        self.actor.redactor = merged.redactor
        return merged

    async def _after_turn(self, bundle: Any) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for extension in self.actor.extensions:
            try:
                events.extend(await extension.after_turn(bundle))
            except Exception:
                logger.exception(
                    "extension after_turn failed session=%s ext=%s",
                    self.actor.session_id,
                    extension.name,
                )
        self._dynamic_resolver.set([])
        self._dynamic_hook.set([])
        return events

    def _publish_frame(
        self,
        frame: Mapping[str, Any],
        stream: StreamRedactor | None,
    ) -> None:
        actor = self.actor
        if stream is not None and frame.get("type") == "event_delta":
            text = stream.feed(str(frame.get("content_delta") or ""))
            if not text:
                return
            actor.event_log.publish_preview(
                actor.session_id,
                {**frame, "content_delta": text},
            )
            return
        actor.event_log.publish_preview(actor.session_id, dict(frame))

    def _flush_stream(self, stream: StreamRedactor | None) -> None:
        if stream is None:
            return
        tail = stream.flush()
        if not tail:
            return
        self.actor.event_log.publish_preview(
            self.actor.session_id,
            {
                "type": "event_delta",
                "event_type": "agent.message",
                "content_delta": tail,
            },
        )

    async def _run_one(
        self,
        message: StoredEvent,
    ) -> tuple[TurnOutcome, list[dict[str, Any]], bool] | None:
        """Run one model turn up to its outcome.

        Returns None when a turn-setup failure already finished the session
        turn. The bool is True when this attempt was cancelled and must not
        continue into another wake-up.
        """
        actor = self.actor
        turn_open = False
        guard_token = None
        stream: StreamRedactor | None = None
        extra: list[dict[str, Any]] = []
        bundle = None
        aborted = False
        try:
            bundle = await self._ensure_bundle(before_seq=message.seq)
            try:
                contribution = await self._before_turn(bundle)
            except TurnSetupError as exc:
                actor.adapter.begin_turn(actor.record.usage)
                usage_events = actor.adapter.finish_turn().events
                outcome = TurnOutcome(
                    stop_type="retries_exhausted",
                    events=[
                        session_error_event(exc.error_type, exc.message[:500], "exhausted"),
                        *usage_events,
                    ],
                    usage=actor.record.usage,
                )
                if self.tasks is not None and self.tasks.has_running():
                    await self.tasks.cancel_all(
                        error_type="session_stopped",
                        message="task stopped: session_stopped",
                    )
                if self.continuation is not None:
                    self.continuation.close()
                async with actor.lock:
                    await actor.finish_turn_locked(actor.merge_thread_usage(outcome))
                    self._task = None
                    if self._queue:
                        await self._start_locked(self._queue.popleft())
                return None
            if contribution.events:
                await actor.append(contribution.events)
            if contribution.egress_guard is not None:
                guard_token = bind_egress_guard(contribution.egress_guard)
            if actor.redactor is not None and not actor.redactor.empty:
                stream = StreamRedactor(actor.redactor)
            if message.type == "user.message":
                text, unsupported = message_text(message)
            else:
                text = wake_text(message)
                unsupported = False
            if unsupported:
                await actor.append(
                    [
                        session_error_event(
                            "unsupported_content",
                            "image and file content blocks are ignored by this host",
                            "exhausted",
                        )
                    ]
                )
            actor.adapter.begin_turn(actor.record.usage)
            turn_open = True
            async for event in bundle.run_turn(text, should_stop=lambda: self._stop_requested):
                # Convert before the next pull. The runtime yields TOOL_CALL and
                # only then schedules dispatch, so a custom tool's ledger entry
                # must exist before this generator resumes. Awaiting append does
                # not resume it; the next loop iteration does.
                output = actor.adapter.convert(event)
                if output.events:
                    await actor.append(output.events)
                for frame in output.previews:
                    self._publish_frame(frame, stream)
            self._flush_stream(stream)
            outcome = actor.adapter.finish_turn()
        except asyncio.CancelledError:
            self._flush_stream(stream)
            if not turn_open:
                actor.adapter.begin_turn(actor.record.usage)
            actor.adapter.mark_interrupted()
            outcome = actor.adapter.finish_turn()
            aborted = True
        except Exception as exc:
            self._flush_stream(stream)
            logger.exception("managed turn failed session=%s", actor.session_id)
            if not turn_open:
                actor.adapter.begin_turn(actor.record.usage)
            outcome = actor.adapter.finish_turn(error=exc)
        finally:
            if bundle is not None:
                try:
                    extra = await self._after_turn(bundle)
                except Exception:
                    logger.exception(
                        "extension after_turn failed session=%s",
                        actor.session_id,
                    )
                    extra = []
            if guard_token is not None:
                unbind_egress_guard(guard_token)
        return outcome, extra, aborted

    async def _run(self, message: StoredEvent) -> None:
        actor = self.actor
        outcome: TurnOutcome | None = None
        extra: list[dict[str, Any]] = []
        persisted = False
        aborted = False
        try:
            packed = await self._run_one(message)
            if packed is None:
                return
            outcome, extra, aborted = packed
            while (
                not aborted
                and self.continuation is not None
                and not self._stop_requested
                and outcome.stop_type == "end_turn"
                and self.continuation.has_pending
            ):
                if not persisted:
                    outcome = actor.merge_thread_usage(outcome)
                    if extra:
                        await actor.append(extra)
                    await actor.append(outcome.events)
                    await actor.sync_record(usage=outcome.usage)
                    extra = []
                    persisted = True
                nxt = await self._next_continuation_input()
                if nxt is None:
                    continue
                packed = await self._run_one(nxt)
                if packed is None:
                    return
                outcome, extra, aborted = packed
                persisted = False
        except asyncio.CancelledError:
            aborted = True
            if self.tasks is not None and self.tasks.has_running():
                reason = "interrupted" if self._stop_requested else "session_stopped"
                await self.tasks.cancel_all(
                    error_type=reason,
                    message=f"task stopped: {reason}",
                )
            if self.continuation is not None:
                self.continuation.close()
            if outcome is None:
                raise
        if outcome is None:
            return
        if self.tasks is not None and self.tasks.has_running():
            reason = "interrupted" if self._stop_requested or aborted else "session_stopped"
            await self.tasks.cancel_all(error_type=reason, message=f"task stopped: {reason}")
        if self.continuation is not None:
            self.continuation.close()
        final = (
            outcome
            if not persisted
            else TurnOutcome(stop_type=outcome.stop_type, events=[], usage=outcome.usage)
        )
        final = actor.merge_thread_usage(final)
        async with actor.lock:
            if extra and not persisted:
                await actor.append(extra)
            await actor.finish_turn_locked(final)
            if self._grace_task is not None and not self._grace_task.done():
                self._grace_task.cancel()
            self._task = None
            if self._queue:
                await self._start_locked(self._queue.popleft())

    async def _next_continuation_input(self) -> StoredEvent | None:
        async with self.actor.lock:
            if self._queue:
                msg = self._queue.popleft()
                await self.actor.service.store.mark_processed(
                    self.actor.tenant_id,
                    self.actor.session_id,
                    [msg.id],
                    utc_now_iso(),
                )
                return msg
        if self._stop_requested or self.continuation is None:
            return None
        wake: WakeUp | None = await self.continuation.wait()
        return None if wake is None else wake.event

    async def on_resolved(self, resolutions: Mapping[str, ClientEvent]) -> None:
        self.actor.resolve_waiters(resolutions)

    async def interrupt(self, dropped_pending: Sequence[str]) -> None:
        logger.debug(
            "interrupt session=%s dropped=%s",
            self.actor.session_id,
            list(dropped_pending),
        )
        self._stop_requested = True
        self.actor.void_waiters()
        if self.continuation is not None:
            self.continuation.close()
        if self.tasks is not None:
            self._interrupt_cancels.append(
                asyncio.create_task(
                    self.tasks.cancel_all(
                        error_type="interrupted",
                        message="task stopped: interrupted",
                    )
                )
            )
        if self.actor.threads is not None:
            self._interrupt_cancels.append(asyncio.create_task(self.actor.threads.interrupt_all()))
        task = self._task
        if task is not None and not task.done():
            self._grace_task = asyncio.create_task(self._grace_kill(task))

    async def _grace_kill(self, task: asyncio.Task[None]) -> None:
        await asyncio.sleep(self.actor.service.config.interrupt_grace_seconds)
        if not task.done():
            task.cancel()

    async def close(self) -> None:
        if self.tasks is not None:
            await self.tasks.close()
        if self.actor.threads is not None:
            await self.actor.threads.close()
        self._queue.clear()
        pending = [
            task
            for task in (self._grace_task, self._task, *self._interrupt_cancels)
            if task is not None and not task.done()
        ]
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("managed turn did not close cleanly session=%s", self.actor.session_id)
        for extension in self.actor.extensions:
            try:
                await extension.close()
            except Exception:
                logger.exception(
                    "extension close failed session=%s ext=%s",
                    self.actor.session_id,
                    getattr(extension, "name", ""),
                )


__all__ = [
    "LocalTurnExecutor",
    "SessionActor",
    "TurnExecutor",
    "content_to_model_text",
    "message_text",
]
