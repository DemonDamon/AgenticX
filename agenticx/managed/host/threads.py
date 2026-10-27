#!/usr/bin/env python3
"""In-session member threads for a coordinating managed agent.

Author: Damon Li

Member threads share the session work directory and event log. They do not
reuse personal-mode delegation, and they never enter the session state machine.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from agenticx.managed.errors import INVALID_REQUEST, MAError, THREAD_NOT_FOUND
from agenticx.managed.events.adapter import RuntimeEventAdapter
from agenticx.managed.events.store import SESSION_VISIBLE_THREAD_TYPES, StoredEvent
from agenticx.managed.host.continuation import TurnContinuation, WakeUp
from agenticx.managed.host.platform_tools import PlatformToolResolver
from agenticx.managed.ids import new_ulid
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.permissions import (
    ManagedConfirmGate,
    ManagedPermissionHook,
    PermissionDecision,
    PermissionEngine,
    ToolAuthorization,
)
from agenticx.managed.protocol import Usage
from agenticx.managed.spec import AgentSpec, compile_spec, split_model_ref

logger = logging.getLogger(__name__)

THREAD_TOOL_NAMES = ("list_agents", "send_to_agent")
ADVISOR_TOOL_NAME = "advisor"
MAX_ACTIVE_THREADS = 25  # including the primary thread; advisor threads excluded
MAX_THREAD_MESSAGE_CHARS = 32000
MAX_ADVISOR_QUESTION_CHARS = 8000
ADVISOR_HISTORY_MESSAGES = 20
ADVISOR_HISTORY_CHARS = 24000
REPORT_INTERRUPTED_TEXT = "[member thread interrupted by user]"
DEFAULT_ADVISOR_INSTRUCTIONS = (
    "You are a senior advisor consulted by a coordinating agent. Read the conversation so far "
    "and give concise, concrete advice: risks, missing steps, and the next best action. "
    "Do not call tools. Answer in the language of the conversation."
)
_THREAD_LIMIT_ERROR = "ERROR: thread limit reached (25 active threads per session); archive idle threads first"
_SUMMARY_TYPES = tuple(sorted(SESSION_VISIBLE_THREAD_TYPES))

LIST_AGENTS_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "list_agents",
        "description": "List member agents you can delegate to, with their threads.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}
SEND_TO_AGENT_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "send_to_agent",
        "description": (
            "Delegate a task to a member agent. Returns immediately with a thread_id; "
            "the member works in its own context, shares the session files, and reports "
            "back automatically. Give input paths, constraints, and the expected output."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent": {
                    "type": "string",
                    "description": '"self" or a member agent id from list_agents.',
                },
                "message": {"type": "string"},
                "thread_id": {
                    "type": "string",
                    "description": "Follow up on an existing thread of this member.",
                },
                "new_thread": {
                    "type": "boolean",
                    "description": "Start another copy instead of reusing the latest thread.",
                },
            },
            "required": ["agent", "message"],
        },
    },
}
ADVISOR_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "advisor",
        "description": (
            "Ask the advisor for a one-off review of the conversation so far. Returns advice text."
        ),
        "parameters": {
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "required": [],
        },
    },
}


def _add_usage(left: Usage, right: Usage) -> Usage:
    return Usage(
        input_tokens=left.input_tokens + right.input_tokens,
        output_tokens=left.output_tokens + right.output_tokens,
        cache_read_input_tokens=left.cache_read_input_tokens
        + right.cache_read_input_tokens,
        tool_calls=left.tool_calls + right.tool_calls,
        runtime_ms=left.runtime_ms + right.runtime_ms,
    )


def _sub_usage(current: Usage, previous: Usage) -> Usage:
    return Usage(
        input_tokens=max(0, current.input_tokens - previous.input_tokens),
        output_tokens=max(0, current.output_tokens - previous.output_tokens),
        cache_read_input_tokens=max(
            0, current.cache_read_input_tokens - previous.cache_read_input_tokens
        ),
        tool_calls=max(0, current.tool_calls - previous.tool_calls),
        runtime_ms=max(0, current.runtime_ms - previous.runtime_ms),
    )


def _usage_is_zero(usage: Usage) -> bool:
    return (
        usage.input_tokens == 0
        and usage.output_tokens == 0
        and usage.cache_read_input_tokens == 0
        and usage.tool_calls == 0
        and usage.runtime_ms == 0
    )


def _text_of(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if (
            isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        ):
            parts.append(block["text"])
    return "\n".join(parts)


def _last_agent_message(events: list[StoredEvent]) -> str:
    text = ""
    for event in events:
        if event.type != "agent.message":
            continue
        text = _text_of(event.payload.get("content"))
    return text


def _clear_cancellation() -> None:
    """Swallow one forced cancel so the member task can still persist its report."""
    task = asyncio.current_task()
    if task is None:
        return
    while task.cancelling():
        task.uncancel()


@dataclass
class MemberDescriptor:
    key: str  # "self" or the member agent id
    kind: Literal["self", "agent"]
    agent_id: str
    agent_version: int
    name: str
    description: str | None
    available: bool
    unavailable_reason: str | None
    spec: AgentSpec | None  # None when unavailable


@dataclass
class ThreadState:
    thread_id: str
    member_key: str  # "self", agent id, or "advisor"
    agent: dict[str, Any]  # ThreadAgentRef wire
    status: Literal["idle", "running", "terminated"]
    stop_reason: dict[str, Any] | None = None
    terminated_reason: str | None = None
    runner: ThreadRunner | None = None


class MemberPermissionEngine(PermissionEngine):
    """Member threads: ask -> deny, custom -> deny (D7)."""

    def evaluate(
        self,
        tool_name: str,
        arguments: Mapping[str, Any] | None,
    ) -> PermissionDecision:
        if tool_name in self.spec.custom_tool_names:
            return PermissionDecision(
                decision="deny",
                evaluated_policy="always_ask",
                source="manifest",
                subject=tool_name,
                reason=f'tool "{tool_name}" is not available in member threads',
            )
        decision = super().evaluate(tool_name, arguments)
        if decision.decision == "ask":
            return PermissionDecision(
                decision="deny",
                evaluated_policy="always_ask",
                source=decision.source,
                subject=decision.subject,
                reason=f'tool "{tool_name}" requires approval, which member threads do not support',
            )
        return decision


class ThreadBroker:
    """ActionBroker for one member thread. request_action is never reached (MemberPermissionEngine)."""

    def __init__(self, runner: ThreadRunner) -> None:
        self._runner = runner

    async def announce_tool_use(
        self,
        *,
        kind: Any,
        name: str,
        input: Mapping[str, Any],
        evaluated_policy: Any,
        mcp_server: str | None = None,
        ledger_name: str | None = None,
    ) -> str:
        events = self._runner.adapter.build_tool_use(
            kind=kind,
            name=name,
            input=input,
            evaluated_policy=evaluated_policy,
            mcp_server=mcp_server,
            ledger_name=ledger_name,
        )
        tid = self._runner.state.thread_id
        for event in events:
            event["thread_id"] = tid
        await self._runner.manager.actor.append(events)
        return str(events[-1]["id"])

    async def request_action(self, event_id: str, kind: Any) -> None:
        del event_id, kind
        return None

    def custom_tool_use_id(self, name: str) -> str | None:
        del name
        return None


class ThreadRunner:
    """Runs one member thread: its own bundle, adapter, and FIFO of coordinator messages."""

    def __init__(
        self, *, manager: ThreadManager, state: ThreadState, member: MemberDescriptor
    ) -> None:
        self.manager = manager
        self.state = state
        self.member = member
        self.adapter = RuntimeEventAdapter(
            model_ref=member.spec.model_ref if member.spec is not None else "",
            kind_of=(
                member.spec.kind_of if member.spec is not None else (lambda _name: None)
            ),
        )
        self.usage = Usage()
        self.bundle: Any = None
        self._queue: deque[tuple[str, str]] = deque()
        self._task: asyncio.Task[None] | None = None
        self._stop = False
        self._report = True
        self._grace: asyncio.Task[None] | None = None
        self._inflight_key: str | None = None

    def enqueue(self, text: str, pending_key: str) -> bool:
        """Queue one coordinator message. True when it waits behind a running turn."""
        running = self._task is not None and not self._task.done()
        self._queue.append((text, pending_key))
        if running:
            return True
        self._task = asyncio.create_task(
            self._loop(), name=f"ma-thread-{self.state.thread_id}"
        )
        return False

    def interrupt(self, *, report: bool) -> None:
        self._stop = True
        self._report = report
        if not report:
            pending = list(self._queue)
            self._queue.clear()
            for _text, key in pending:
                self.manager.continuation.resolve_pending(key, None)
        task = self._task
        if task is not None and not task.done():
            self._grace = asyncio.create_task(self._grace_cancel(task))

    async def _grace_cancel(self, task: asyncio.Task[None]) -> None:
        await asyncio.sleep(self.manager.actor.service.config.interrupt_grace_seconds)
        if not task.done():
            task.cancel()

    async def close(self) -> None:
        self._stop = True
        self._report = False
        task = self._task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception(
                    "member thread did not close thread=%s", self.state.thread_id
                )
        if self._grace is not None and not self._grace.done():
            self._grace.cancel()

    async def _loop(self) -> None:
        try:
            while self._queue:
                if self.manager.suppress_reports and not self._report:
                    break
                text, key = self._queue.popleft()
                self._inflight_key = key
                try:
                    await self._run_turn(text, key)
                finally:
                    self._inflight_key = None
                if self._stop and not self._report:
                    break
                self._stop = False
                self._report = True
        finally:
            leftover = list(self._queue)
            self._queue.clear()
            for _text, key in leftover:
                self.manager.continuation.resolve_pending(key, None)

    async def _ensure_bundle(self) -> Any:
        if self.bundle is not None:
            return self.bundle
        member = self.member
        if member.spec is None:
            raise RuntimeError("member spec missing")
        actor = self.manager.actor
        context = LLMCallContext(
            tenant_id=actor.tenant_id,
            session_id=actor.session_id,
            agent_id=member.agent_id,
            agent_version=member.agent_version,
            user_id=actor.record.created_by_user_id,
            thread_id=self.state.thread_id,
            thread_role=member.kind,
        )
        auth = ToolAuthorization()
        engine = MemberPermissionEngine(
            member.spec, actor.service.config.enterprise_policy
        )
        hook = ManagedPermissionHook(
            engine=engine,
            broker=ThreadBroker(self),
            authorization=auth,
        )
        bundle = actor.service.builder.build(
            member.spec,
            context=context,
            confirm_gate=ManagedConfirmGate(auth),
            hooks=[hook],
            custom_tool_resolver=None,
            history=[],
        )
        hidden = member.spec.custom_tool_names
        bundle.tools[:] = [
            schema
            for schema in bundle.tools
            if schema["function"]["name"] not in hidden
        ]
        bundle.session._session_id = f"{actor.session_id}.{self.state.thread_id}"
        self.bundle = bundle
        return bundle

    async def _run_turn(self, text: str, pending_key: str) -> None:
        manager = self.manager
        actor = manager.actor
        tid = self.state.thread_id
        resolved = False
        outcome = None
        collected: list[StoredEvent] = []
        interrupted = False
        try:
            self.state.status = "running"
            stored = await manager.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "session.thread_status_running",
                        "thread_id": tid,
                    },
                    {
                        "id": new_ulid(),
                        "type": "agent.thread_message_received",
                        "thread_id": tid,
                        "from_thread_id": None,
                        "from_agent_name": "coordinator",
                        "content": [{"type": "text", "text": text}],
                    },
                ]
            )
            collected.extend(stored)
            bundle = await self._ensure_bundle()
            turn_open = False
            try:
                self.adapter.begin_turn(self.usage)
                turn_open = True
                async for event in bundle.run_turn(
                    text, should_stop=lambda: self._stop
                ):
                    output = self.adapter.convert(event)
                    if output.events:
                        for item in output.events:
                            item["thread_id"] = tid
                        collected.extend(await actor.append(output.events))
                outcome = self.adapter.finish_turn()
            except asyncio.CancelledError:
                _clear_cancellation()
                interrupted = True
                if not turn_open:
                    self.adapter.begin_turn(self.usage)
                self.adapter.mark_interrupted()
                outcome = self.adapter.finish_turn()
            except Exception as exc:
                logger.exception("member turn failed thread=%s", tid)
                if not turn_open:
                    self.adapter.begin_turn(self.usage)
                outcome = self.adapter.finish_turn(error=exc)
            if self._stop:
                interrupted = True
            for item in outcome.events:
                item["thread_id"] = tid
            collected.extend(await actor.append(outcome.events))
            manager._usage_delta = _add_usage(
                manager._usage_delta, _sub_usage(outcome.usage, self.usage)
            )
            self.usage = outcome.usage
            stop_type = (
                outcome.stop_type
                if outcome.stop_type != "requires_action"
                else "end_turn"
            )
            stop_reason = {"type": stop_type, "event_ids": []}
            await manager.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "session.thread_status_idle",
                        "thread_id": tid,
                        "stop_reason": stop_reason,
                    }
                ]
            )
            self.state.status = "idle"
            self.state.stop_reason = stop_reason
            report = self._report and not manager.suppress_reports
            if not report:
                manager.continuation.resolve_pending(pending_key, None)
                resolved = True
                return
            if interrupted:
                report_text = REPORT_INTERRUPTED_TEXT
            else:
                report_text = _last_agent_message(collected).strip()
                if not report_text:
                    report_text = f"[member thread stopped: {stop_type}]"
            reported = await manager.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "agent.thread_message_sent",
                        "thread_id": tid,
                        "to_thread_id": None,
                        "to_agent_name": "coordinator",
                        "content": [{"type": "text", "text": report_text}],
                    },
                    {
                        "id": new_ulid(),
                        "type": "agent.thread_message_received",
                        "thread_id": None,
                        "from_thread_id": tid,
                        "from_agent_name": self.member.name,
                        "content": [{"type": "text", "text": report_text}],
                    },
                ]
            )
            wake = next(
                item
                for item in reported
                if item.type == "agent.thread_message_received"
            )
            manager.continuation.resolve_pending(pending_key, WakeUp("thread", wake))
            resolved = True
        finally:
            if not resolved:
                manager.continuation.resolve_pending(pending_key, None)


@dataclass
class ThreadManager:
    """Per-session member threads. Created by LocalTurnExecutor when spec.multiagent is set."""

    actor: Any
    continuation: TurnContinuation
    _members: list[MemberDescriptor] = field(default_factory=list)
    _advisor: dict[str, Any] | None = field(default=None)
    _states: dict[str, ThreadState] = field(default_factory=dict)
    _order: list[str] = field(default_factory=list)
    _loaded: bool = False
    _usage_delta: Usage = field(default_factory=Usage)
    suppress_reports: bool = False
    _bundle_getter: Callable[[], Any] | None = field(default=None)

    async def load(self) -> None:
        """Fold existing thread events once; mark non-terminated member threads context_lost."""
        if self._loaded:
            return
        self._loaded = True
        await self._resolve_members()
        rows: list[StoredEvent] = []
        cursor = 0
        store = self.actor.service.store
        while True:
            batch = await store.list_events(
                self.actor.tenant_id,
                self.actor.session_id,
                after_seq=cursor,
                limit=500,
                types=list(_SUMMARY_TYPES),
            )
            rows.extend(batch)
            if len(batch) < 500:
                break
            cursor = batch[-1].seq
        for event in rows:
            self._apply_folded(event)
        for state in list(self._states.values()):
            if state.status == "terminated":
                continue
            await self._append_status(state.thread_id, "context_lost")
            state.status = "terminated"
            state.terminated_reason = "context_lost"

    def install(
        self,
        resolver: PlatformToolResolver,
        *,
        primary_bundle_getter: Callable[[], Any],
    ) -> list[str]:
        """Register list_agents / send_to_agent (and advisor when configured)."""
        self._bundle_getter = primary_bundle_getter
        names = ["list_agents", "send_to_agent"]
        resolver.register("list_agents", LIST_AGENTS_SCHEMA, self._on_list)
        resolver.register("send_to_agent", SEND_TO_AGENT_SCHEMA, self._on_send)
        if self._advisor is not None:
            resolver.register(ADVISOR_TOOL_NAME, ADVISOR_SCHEMA, self._on_advise)
            names.append(ADVISOR_TOOL_NAME)
        return names

    async def _on_list(
        self, arguments: dict[str, Any], tool_call_id: str | None
    ) -> str:
        del arguments, tool_call_id
        try:
            return await self.list_agents()
        except Exception:
            logger.exception("list_agents failed session=%s", self.actor.session_id)
            return "ERROR: tool list_agents failed"

    async def _on_send(
        self, arguments: dict[str, Any], tool_call_id: str | None
    ) -> str:
        del tool_call_id
        try:
            return await self.send(arguments)
        except Exception:
            logger.exception("send_to_agent failed session=%s", self.actor.session_id)
            return "ERROR: tool send_to_agent failed"

    async def _on_advise(
        self, arguments: dict[str, Any], tool_call_id: str | None
    ) -> str:
        del tool_call_id
        getter = self._bundle_getter
        if getter is None:
            return "ERROR: advisor failed: RuntimeError"
        try:
            return await self.advise(arguments, getter())
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("advisor failed session=%s", self.actor.session_id)
            return f"ERROR: advisor failed: {type(exc).__name__}"

    async def list_agents(self) -> str:
        body = {
            "agents": [self._member_wire(member) for member in self._members],
            "advisor_available": self._advisor is not None,
        }
        return json.dumps(body, ensure_ascii=False)

    def _member_wire(self, member: MemberDescriptor) -> dict[str, Any]:
        threads = []
        for thread_id in self._order:
            state = self._states[thread_id]
            if state.member_key != member.key or state.status == "terminated":
                continue
            threads.append({"thread_id": state.thread_id, "status": state.status})
        item: dict[str, Any] = {
            "agent": member.key,
            "type": member.kind,
            "name": member.name,
            "description": member.description,
            "available": member.available,
            "threads": threads,
        }
        if member.kind == "agent":
            item["version"] = member.agent_version
        if not member.available:
            item["unavailable_reason"] = member.unavailable_reason
        return item

    async def send(self, arguments: dict[str, Any]) -> str:
        agent = arguments.get("agent")
        if not isinstance(agent, str) or agent == "":
            shown = agent if isinstance(agent, str) else ""
            return f'ERROR: unknown agent "{shown}"; call list_agents first'
        member = next((item for item in self._members if item.key == agent), None)
        if member is None:
            return f'ERROR: unknown agent "{agent}"; call list_agents first'
        if not member.available or member.spec is None:
            reason = member.unavailable_reason or "manifest invalid"
            return f'ERROR: agent "{agent}" is not available ({reason})'
        message = arguments.get("message")
        if not isinstance(message, str) or message == "":
            return "ERROR: message is required"
        if len(message) > MAX_THREAD_MESSAGE_CHARS:
            return "ERROR: message exceeds 32000 characters"
        requested = arguments.get("thread_id")
        new_thread = arguments.get("new_thread") is True
        state: ThreadState | None = None
        if isinstance(requested, str) and requested != "":
            state = self._states.get(requested)
            if state is None or state.member_key != member.key:
                return f'ERROR: thread {requested} does not belong to agent "{agent}"'
            if state.status == "terminated":
                return f"ERROR: thread {requested} is terminated"
        elif new_thread or self._latest_open(member.key) is None:
            if self._active_ordinary() >= MAX_ACTIVE_THREADS:
                return _THREAD_LIMIT_ERROR
            state = await self._create_thread(member)
        else:
            state = self._latest_open(member.key)
        if state is None or state.runner is None:
            return f'ERROR: agent "{agent}" is not available (manifest invalid)'
        pending_key = f"thread:{state.thread_id}:{new_ulid()}"
        await self.append(
            [
                {
                    "id": new_ulid(),
                    "type": "agent.thread_message_sent",
                    "thread_id": None,
                    "to_thread_id": state.thread_id,
                    "to_agent_name": member.name,
                    "content": [{"type": "text", "text": message}],
                }
            ]
        )
        self.continuation.register_pending(pending_key)
        queued = state.runner.enqueue(message, pending_key)
        return json.dumps(
            {
                "delivered": True,
                "thread_id": state.thread_id,
                "agent": member.key,
                "queued": queued,
                "note": (
                    "The member will report back automatically. Continue other work or end your turn; do not poll."
                ),
            },
            ensure_ascii=False,
        )

    async def advise(self, arguments: dict[str, Any], primary_bundle: Any) -> str:
        if self._advisor is None:
            return "ERROR: advisor failed: RuntimeError"
        question = arguments.get("question")
        if question is None:
            question_text = ""
        elif not isinstance(question, str):
            return "ERROR: question must be a string"
        else:
            question_text = question
        if len(question_text) > MAX_ADVISOR_QUESTION_CHARS:
            return "ERROR: question exceeds 8000 characters"
        advisor = self._advisor
        tid = new_ulid()
        model_ref = str(advisor.get("model") or "")
        agent_wire = {"type": "advisor", "model": model_ref}
        state = ThreadState(
            thread_id=tid, member_key="advisor", agent=agent_wire, status="running"
        )
        self._states[tid] = state
        self._order.append(tid)
        await self.append(
            [
                {
                    "id": new_ulid(),
                    "type": "session.thread_created",
                    "thread_id": tid,
                    "agent": agent_wire,
                    "parent_thread_id": None,
                },
                {
                    "id": new_ulid(),
                    "type": "session.thread_status_running",
                    "thread_id": tid,
                },
            ]
        )
        try:
            transcript = _advisor_transcript(
                getattr(primary_bundle.session, "agent_messages", [])
            )
            user_text = transcript + (
                f"\n\nQuestion: {question_text}" if question_text else ""
            )
            provider, model = split_model_ref(model_ref)
            actor = self.actor
            context = LLMCallContext(
                tenant_id=actor.tenant_id,
                session_id=actor.session_id,
                agent_id=actor.record.agent_id,
                agent_version=actor.record.agent_version,
                user_id=actor.record.created_by_user_id,
                thread_id=tid,
                thread_role="advisor",
            )
            await self.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "span.model_request_start",
                        "thread_id": tid,
                        "model": model_ref,
                    }
                ]
            )
            llm = actor.service.builder.llm_factory.create(
                provider=provider, model=model, context=context
            )
            instructions = advisor.get("instructions") or DEFAULT_ADVISOR_INSTRUCTIONS
            resp = await asyncio.to_thread(
                llm.invoke,
                [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": user_text},
                ],
            )
            text = str(getattr(resp, "content", "") or "").strip()
            prompt_tokens, completion_tokens = _response_tokens(resp)
            self._usage_delta = _add_usage(
                self._usage_delta,
                Usage(input_tokens=prompt_tokens, output_tokens=completion_tokens),
            )
            await self.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "span.model_request_end",
                        "thread_id": tid,
                        "model": model_ref,
                        "is_error": False,
                        "model_usage": Usage(
                            input_tokens=prompt_tokens,
                            output_tokens=completion_tokens,
                        ).model_dump(),
                    },
                    {
                        "id": new_ulid(),
                        "type": "agent.message",
                        "thread_id": tid,
                        "content": [{"type": "text", "text": text}],
                    },
                    {
                        "id": new_ulid(),
                        "type": "agent.thread_message_received",
                        "thread_id": None,
                        "from_thread_id": tid,
                        "from_agent_name": "advisor",
                        "content": [{"type": "text", "text": text}],
                    },
                ]
            )
            await self._append_status(tid, "completed")
            state.status = "terminated"
            state.terminated_reason = "completed"
            if not text:
                return "ERROR: advisor returned no advice"
            return text
        except asyncio.CancelledError:
            await self._append_status(tid, "completed")
            state.status = "terminated"
            state.terminated_reason = "completed"
            raise
        except Exception as exc:
            logger.exception("advisor failed session=%s", self.actor.session_id)
            await self._append_advisor_failure(tid, model_ref)
            state.status = "terminated"
            state.terminated_reason = "completed"
            return f"ERROR: advisor failed: {type(exc).__name__}"

    def has_active(self) -> bool:
        return any(
            state.member_key != "advisor" and state.status == "running"
            for state in self._states.values()
        )

    def known_thread(self, thread_id: str) -> bool:
        return thread_id in self._states

    async def interrupt_thread(self, thread_id: str) -> None:
        state = self._states.get(thread_id)
        if state is None or state.runner is None or state.status != "running":
            return
        state.runner.interrupt(report=True)

    async def interrupt_all(self) -> None:
        self.suppress_reports = True
        for state in self._states.values():
            if state.runner is None:
                continue
            state.runner.interrupt(report=False)
            inflight = state.runner._inflight_key
            if inflight is not None:
                self.continuation.resolve_pending(inflight, None)

    def resume_reports(self) -> None:
        self.suppress_reports = False

    async def archive(self, thread_id: str) -> None:
        if not self._loaded:
            await self.load()
        state = self._states.get(thread_id)
        if state is None:
            raise MAError(THREAD_NOT_FOUND, "thread not found")
        if state.status == "running":
            raise MAError(INVALID_REQUEST, "thread must be idle to archive")
        if state.status == "terminated":
            return
        await self._append_status(thread_id, "archived")
        state.status = "terminated"
        state.terminated_reason = "archived"

    def take_usage_delta(self) -> Usage:
        delta = self._usage_delta
        self._usage_delta = Usage()
        return delta

    async def close(self) -> None:
        self.suppress_reports = True
        runners = [
            state.runner for state in self._states.values() if state.runner is not None
        ]
        for runner in runners:
            runner.interrupt(report=False)
        for runner in runners:
            await runner.close()
        for state in self._states.values():
            if state.status == "terminated":
                continue
            await self._append_status(state.thread_id, "session_closed")
            state.status = "terminated"
            state.terminated_reason = "session_closed"

    async def append(self, events: list[dict[str, Any]]) -> list[StoredEvent]:
        return await self.actor.append(events)

    async def _resolve_members(self) -> None:
        config = self.actor.spec.multiagent or {}
        agents = config.get("agents") or []
        registry = self.actor.service.registry
        tenant = self.actor.tenant_id
        for member in agents:
            if not isinstance(member, Mapping):
                continue
            kind = member.get("type")
            if kind == "advisor":
                self._advisor = dict(member)
                continue
            if kind == "self":
                record = await registry.get_agent(tenant, self.actor.record.agent_id)
                name = (
                    record.display_name
                    if record is not None
                    else self.actor.record.agent_id
                )
                description = record.description if record is not None else None
                self._members.append(
                    MemberDescriptor(
                        key="self",
                        kind="self",
                        agent_id=self.actor.record.agent_id,
                        agent_version=self.actor.record.agent_version,
                        name=name,
                        description=description,
                        available=True,
                        unavailable_reason=None,
                        spec=self.actor.spec,
                    )
                )
                continue
            if kind != "agent":
                continue
            agent_id = str(member.get("id") or "")
            requested = member.get("version")
            version_number = requested if isinstance(requested, int) else 0
            record = await registry.get_agent(tenant, agent_id)
            if record is None:
                self._members.append(
                    _unavailable(
                        agent_id, version_number, "agent not found", name=agent_id
                    )
                )
                continue
            if record.status != "active":
                self._members.append(
                    _unavailable(
                        agent_id,
                        version_number,
                        "agent is disabled",
                        name=record.display_name,
                        description=record.description,
                    )
                )
                continue
            version = await registry.get_version(
                tenant, agent_id, requested if isinstance(requested, int) else None
            )
            if version is None:
                self._members.append(
                    _unavailable(
                        agent_id,
                        version_number,
                        "version not found",
                        name=record.display_name,
                        description=record.description,
                    )
                )
                continue
            try:
                spec = compile_spec(agent_id, version.version, version.manifest)
            except MAError:
                self._members.append(
                    _unavailable(
                        agent_id,
                        version.version,
                        "manifest invalid",
                        name=record.display_name,
                        description=record.description,
                    )
                )
                continue
            if spec.multiagent is not None:
                self._members.append(
                    _unavailable(
                        agent_id,
                        version.version,
                        "member is a coordinator",
                        name=record.display_name,
                        description=record.description,
                    )
                )
                continue
            self._members.append(
                MemberDescriptor(
                    key=agent_id,
                    kind="agent",
                    agent_id=agent_id,
                    agent_version=version.version,
                    name=record.display_name,
                    description=record.description,
                    available=True,
                    unavailable_reason=None,
                    spec=spec,
                )
            )

    def _apply_folded(self, event: StoredEvent) -> None:
        thread_id = event.thread_id
        if not thread_id:
            return
        if event.type == "session.thread_created":
            agent = event.payload.get("agent")
            agent_wire = dict(agent) if isinstance(agent, Mapping) else {}
            kind = agent_wire.get("type")
            if kind == "advisor":
                key = "advisor"
            elif kind == "self":
                key = "self"
            else:
                key = str(agent_wire.get("agent_id") or "")
            self._states[thread_id] = ThreadState(
                thread_id=thread_id,
                member_key=key,
                agent=agent_wire,
                status="idle",
            )
            self._order.append(thread_id)
            return
        state = self._states.get(thread_id)
        if state is None:
            return
        if event.type == "session.thread_status_running":
            if state.status != "terminated":
                state.status = "running"
        elif event.type == "session.thread_status_idle":
            if state.status != "terminated":
                state.status = "idle"
                reason = event.payload.get("stop_reason")
                state.stop_reason = (
                    dict(reason) if isinstance(reason, Mapping) else None
                )
        elif event.type == "session.thread_status_terminated":
            state.status = "terminated"
            raw_reason = event.payload.get("reason")
            state.terminated_reason = (
                raw_reason if isinstance(raw_reason, str) else None
            )

    def _latest_open(self, member_key: str) -> ThreadState | None:
        found: ThreadState | None = None
        for thread_id in self._order:
            state = self._states[thread_id]
            if state.member_key == member_key and state.status != "terminated":
                found = state
        return found

    def _active_ordinary(self) -> int:
        count = 1
        for state in self._states.values():
            if state.member_key == "advisor" or state.status == "terminated":
                continue
            count += 1
        return count

    async def _create_thread(self, member: MemberDescriptor) -> ThreadState:
        thread_id = new_ulid()
        agent_wire = {
            "type": member.kind,
            "agent_id": member.agent_id,
            "agent_version": member.agent_version,
            "name": member.name,
        }
        state = ThreadState(
            thread_id=thread_id, member_key=member.key, agent=agent_wire, status="idle"
        )
        runner = ThreadRunner(manager=self, state=state, member=member)
        state.runner = runner
        self._states[thread_id] = state
        self._order.append(thread_id)
        await self.append(
            [
                {
                    "id": new_ulid(),
                    "type": "session.thread_created",
                    "thread_id": thread_id,
                    "agent": agent_wire,
                    "parent_thread_id": None,
                }
            ]
        )
        return state

    async def _append_status(self, thread_id: str, reason: str) -> None:
        await self.append(
            [
                {
                    "id": new_ulid(),
                    "type": "session.thread_status_terminated",
                    "thread_id": thread_id,
                    "reason": reason,
                }
            ]
        )

    async def _append_advisor_failure(self, thread_id: str, model_ref: str) -> None:
        try:
            await self.append(
                [
                    {
                        "id": new_ulid(),
                        "type": "span.model_request_end",
                        "thread_id": thread_id,
                        "model": model_ref,
                        "is_error": True,
                        "model_usage": Usage().model_dump(),
                    }
                ]
            )
            await self._append_status(thread_id, "completed")
        except Exception:
            logger.exception("advisor failure events dropped thread=%s", thread_id)


def _unavailable(
    agent_id: str,
    version: int,
    reason: str,
    *,
    name: str,
    description: str | None = None,
) -> MemberDescriptor:
    return MemberDescriptor(
        key=agent_id,
        kind="agent",
        agent_id=agent_id,
        agent_version=version,
        name=name,
        description=description,
        available=False,
        unavailable_reason=reason,
        spec=None,
    )


def _advisor_transcript(messages: Any) -> str:
    selected: list[tuple[str, str]] = []
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, Mapping):
                continue
            role = message.get("role")
            content = message.get("content")
            if role in ("user", "assistant") and isinstance(content, str):
                selected.append((str(role), content[:4000]))
    selected = selected[-ADVISOR_HISTORY_MESSAGES:]
    while selected and len(_join_transcript(selected)) > ADVISOR_HISTORY_CHARS:
        selected.pop(0)
    return _join_transcript(selected)


def _join_transcript(lines: list[tuple[str, str]]) -> str:
    return "\n".join(f"{role}: {text}" for role, text in lines)


def _response_tokens(resp: Any) -> tuple[int, int]:
    usage = getattr(resp, "usage", None)
    if isinstance(usage, Mapping):
        return _token(usage.get("prompt_tokens")), _token(
            usage.get("completion_tokens")
        )
    if usage is None:
        return 0, 0
    return _token(getattr(usage, "prompt_tokens", 0)), _token(
        getattr(usage, "completion_tokens", 0)
    )


def _token(value: Any) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


__all__ = [
    "ADVISOR_TOOL_NAME",
    "MAX_ACTIVE_THREADS",
    "REPORT_INTERRUPTED_TEXT",
    "THREAD_TOOL_NAMES",
    "MemberDescriptor",
    "ThreadManager",
    "ThreadRunner",
    "ThreadState",
]
