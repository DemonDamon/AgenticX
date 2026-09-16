#!/usr/bin/env python3
"""Canonical async function-calling ReAct agent (embeddable SDK primitive).

Native OpenAI-style ``tool_calls`` loop with full async, streaming typed events,
multi-turn history, optional compaction/offload, and ``LoopDetector`` nudges.
Does **not** use ``AgentExecutor`` or any Studio/CLI runtime.

    from agenticx.agents import ReActAgent

    agent = ReActAgent(llm=provider, tools=[echo_tool], system_prompt="...")
    result = await agent.arun("hello")
    async for event in agent.astream("hello"):
        ...

The legacy text-JSON ReAct facade lives in ``react_agent.TextReActAgent``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence

from agenticx.agents.agent_events import (
    AgentEvent,
    ErrorEvent,
    FinalEvent,
    InterruptedEvent,
    ReasoningEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from agenticx.core.agent_executor import ToolRegistry
from agenticx.core.offload.protocol import Offloader, should_offload
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse
from agenticx.reliability.call_identity import (
    canonical_call_key,
    diff_canonical_fields,
    stable_call_id,
)
from agenticx.reliability.call_ledger import CallLedger, Verdict
from agenticx.reliability.errors import ToolCallIdentityError
from agenticx.reliability.replay_policy import ReplayRequest, decide_replay
from agenticx.reliability.run_state import PendingCall, RunState, RunStateStore
from agenticx.runtime.interrupted_closers import (
    KIND_OUTCOME_UNKNOWN,
    OUTCOME_UNKNOWN_CONTENT,
)
from agenticx.runtime.loop_detector import LoopDetector
from agenticx.tools.base import BaseTool

_log = logging.getLogger(__name__)


@dataclass
class ReActResult:
    """Structured result of a canonical ReAct run."""

    success: bool
    output: Any = None
    error: Optional[str] = None
    messages: List[Dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    events: List[AgentEvent] = field(default_factory=list)


def _parse_tool_arguments(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _tool_result_to_str(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=False)
    except Exception:
        return str(result)


class ReActAgent:
    """Async, native function-calling ReAct loop with streaming events."""

    def __init__(
        self,
        *,
        llm: BaseLLMProvider,
        tools: Sequence[BaseTool],
        system_prompt: str = "You are a helpful assistant. Use tools when needed.",
        max_iterations: int = 25,
        compactor: Any | None = None,
        offloader: Offloader | None = None,
        offload_threshold: int | None = None,
        loop_detector: LoopDetector | None = None,
        session_id: str | None = None,
        model_name: str = "",
        run_store: RunStateStore | None = None,
        call_ledger: CallLedger | None = None,
        run_id: str | None = None,
    ) -> None:
        self.llm = llm
        self.system_prompt = system_prompt
        self.max_iterations = max(1, max_iterations)
        self.compactor = compactor
        self.offloader = offloader
        self._offload_threshold = offload_threshold
        self.loop_detector = loop_detector or LoopDetector()
        self.session_id = session_id or str(uuid.uuid4())
        self.model_name = model_name or getattr(llm, "model", "")
        self._run_store = run_store
        self._ledger = call_ledger
        self._run_id = run_id or str(uuid.uuid4())
        self._current_query = ""
        self._state_created_at = 0.0

        self._registry = ToolRegistry()
        self._tools: List[BaseTool] = []
        for tool in tools:
            self.add_tool(tool)

        self._stop_requested = False

    @property
    def tools(self) -> List[BaseTool]:
        return list(self._tools)

    def add_tool(self, tool: BaseTool) -> None:
        if tool is None:
            return
        self._registry.register(tool)
        self._tools.append(tool)

    def stop(self) -> None:
        """Request graceful interruption of the current or next iteration."""
        self._stop_requested = True

    def _tool_schemas(self) -> List[Dict[str, Any]]:
        return [t.to_openai_schema() for t in self._tools]

    def _build_messages(
        self,
        query: str,
        history: Optional[List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
        ]
        if history:
            for msg in history:
                if isinstance(msg, dict) and msg.get("role"):
                    messages.append(dict(msg))
        messages.append({"role": "user", "content": query})
        return messages

    async def _maybe_compact(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if self.compactor is None:
            return messages
        try:
            new_msgs, did, _, _, _ = await self.compactor.maybe_compact(
                messages,
                model=self.model_name,
            )
            if did:
                _log.debug("context compacted session=%s", self.session_id)
            return list(new_msgs)
        except Exception as exc:
            _log.warning("compaction failed: %s", exc)
            return messages

    async def _ainvoke(self, messages: List[Dict[str, Any]]) -> LLMResponse:
        schemas = self._tool_schemas() if self._tools else None
        kwargs: Dict[str, Any] = {}
        if schemas:
            kwargs["tools"] = schemas
            kwargs["tool_choice"] = "auto"
        return await self.llm.ainvoke(messages, **kwargs)

    async def _execute_one_tool(
        self,
        tool_call_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> str:
        tool = self._registry.get(tool_name)
        if tool is None:
            return f"ERROR: unknown tool {tool_name!r}"

        try:
            validated = tool._validate_args(**arguments)
            # Use executor + _run so parallel tool_calls to the same tool name
            # are not serialized by BaseTool._is_running (FR-3).
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: tool._run(**validated),
            )
            body = _tool_result_to_str(result)
        except Exception as exc:
            body = f"ERROR: {exc}"

        if self.offloader is not None and should_offload(
            body,
            threshold=self._offload_threshold or 4096,
        ):
            try:
                ref = await self.offloader.offload_tool_result(
                    self.session_id,
                    body,
                    tool_name=tool_name,
                )
                return ref.to_placeholder()
            except Exception as exc:
                _log.warning("offload failed for %s: %s", tool_name, exc)

        return body

    def _assistant_message_from_response(self, response: LLMResponse) -> Dict[str, Any]:
        msg: Dict[str, Any] = {
            "role": "assistant",
            "content": response.content or None,
        }
        if response.tool_calls:
            msg["tool_calls"] = response.tool_calls
        return msg

    def _normalize_tool_call(
        self,
        tc: Dict[str, Any],
        *,
        iteration: int,
        position: int,
    ) -> tuple[str, str, Dict[str, Any]]:
        """Return (stable_call_id, tool_name, arguments) for one provider tool_call."""
        fn = tc.get("function") or {}
        name = str(fn.get("name", "") or "")
        args = _parse_tool_arguments(fn.get("arguments"))
        call_id = stable_call_id(
            tc.get("id"),
            tool_name=name,
            iteration=iteration,
            position=position,
        )
        return call_id, name, args

    def _save_state(
        self,
        *,
        phase: str,
        messages: List[Dict[str, Any]],
        iteration: int,
        pending_calls: Sequence[PendingCall] = (),
    ) -> None:
        if self._run_store is None:
            return
        now = time.time()
        if not self._state_created_at:
            self._state_created_at = now
        self._run_store.save(
            RunState(
                run_id=self._run_id,
                session_id=self.session_id,
                query=self._current_query,
                messages=list(messages),
                iteration=iteration,
                phase=phase,  # type: ignore[arg-type]
                pending_calls=list(pending_calls),
                created_at=self._state_created_at,
                updated_at=now,
            )
        )

    def _finish_final(
        self,
        messages: List[Dict[str, Any]],
        iterations: int,
        output: Any,
        *,
        success: bool,
    ) -> FinalEvent:
        self._save_state(phase="completed", messages=messages, iteration=iterations)
        if self._run_store is not None:
            self._run_store.clear()
        return FinalEvent(
            output=output,
            success=success,
            messages=list(messages),
            iterations=iterations,
        )

    def _interrupted_event(
        self,
        reason: str,
        messages: List[Dict[str, Any]],
        iteration: int,
    ) -> InterruptedEvent:
        self._save_state(
            phase="interrupted",
            messages=messages,
            iteration=iteration,
        )
        return InterruptedEvent(
            reason=reason,  # type: ignore[arg-type]
            messages=list(messages),
            iteration=iteration,
            run_id=self._run_id,
        )

    def _rewrite_assistant_tool_ids(
        self,
        messages: List[Dict[str, Any]],
        normalized: List[tuple[str, str, Dict[str, Any]]],
    ) -> None:
        if not messages:
            return
        last = messages[-1]
        raw_calls = last.get("tool_calls") or []
        if last.get("role") != "assistant" or not raw_calls:
            return
        rewritten: List[Dict[str, Any]] = []
        for tc, (call_id, _name, _args) in zip(raw_calls, normalized):
            item = dict(tc)
            item["id"] = call_id
            rewritten.append(item)
        last["tool_calls"] = rewritten

    def _enforce_call_identity(
        self,
        normalized: List[tuple[str, str, Dict[str, Any]]],
    ) -> List[tuple[str, str, Dict[str, Any]]]:
        """Drop same-id same-args duplicates; reject same-id changed args."""
        unique: List[tuple[str, str, Dict[str, Any]]] = []
        seen: dict[str, tuple[str, Dict[str, Any]]] = {}
        for call_id, name, args in normalized:
            key = canonical_call_key(name, args)
            if call_id in seen:
                prev_key, prev_args = seen[call_id]
                if prev_key != key:
                    raise ToolCallIdentityError(
                        call_id,
                        recorded_key=prev_key,
                        incoming_key=key,
                        changed_fields=diff_canonical_fields(prev_args, args),
                    )
                continue
            seen[call_id] = (key, args)
            if self._ledger is not None:
                reconciliation = self._ledger.reconcile_safe(call_id, name, args)
                if reconciliation.verdict is Verdict.IDENTITY_CONFLICT:
                    record = reconciliation.record
                    raise ToolCallIdentityError(
                        call_id,
                        recorded_key=record.canonical_key if record else "",
                        incoming_key=key,
                        changed_fields=(
                            diff_canonical_fields(record.arguments, args)
                            if record is not None
                            else ()
                        ),
                    )
            unique.append((call_id, name, args))
        return unique

    async def _append_tool_outcome(
        self,
        messages: List[Dict[str, Any]],
        call_id: str,
        name: str,
        args: Dict[str, Any],
        content: str,
        *,
        success: bool,
        metadata: Dict[str, Any] | None = None,
        persist_ledger: bool = True,
    ) -> ToolResultEvent:
        self.loop_detector.record_call(
            name,
            LoopDetector.args_signature(args),
            has_progress=success,
            result_fingerprint=LoopDetector.fingerprint_from_result(content),
        )
        row: Dict[str, Any] = {
            "role": "tool",
            "tool_call_id": call_id,
            "content": content,
        }
        if metadata:
            row["metadata"] = metadata
        messages.append(row)
        if persist_ledger and self._ledger is not None:
            if success:
                self._ledger.record_result(call_id, content)
            else:
                self._ledger.record_failure(call_id, content)
        return ToolResultEvent(
            tool_call_id=call_id,
            tool_name=name,
            content=content,
            success=success,
        )

    async def _loop(
        self,
        messages: List[Dict[str, Any]],
        *,
        start_iteration: int,
        increment_first: bool = True,
    ) -> AsyncIterator[AgentEvent]:
        """Shared FC loop body used by astream() and aresume()."""
        iterations = start_iteration
        first_pass = True
        try:
            while True:
                if self._stop_requested:
                    yield self._interrupted_event("user_stop", messages, iterations)
                    self._stop_requested = False
                    return
                if first_pass and not increment_first:
                    first_pass = False
                    if iterations >= self.max_iterations:
                        break
                else:
                    if iterations >= self.max_iterations:
                        break
                    iterations += 1
                    first_pass = False

                yield ReasoningEvent(iteration=iterations)

                messages = await self._maybe_compact(messages)
                self._save_state(
                    phase="before_llm",
                    messages=messages,
                    iteration=iterations,
                )
                response = await self._ainvoke(messages)
                tool_calls = list(response.tool_calls or [])
                normalized = [
                    self._normalize_tool_call(
                        tc, iteration=iterations, position=i
                    )
                    for i, tc in enumerate(tool_calls)
                ]
                messages.append(self._assistant_message_from_response(response))
                self._rewrite_assistant_tool_ids(messages, normalized)

                if not tool_calls:
                    yield self._finish_final(
                        messages,
                        iterations,
                        response.content,
                        success=True,
                    )
                    return

                executable = self._enforce_call_identity(normalized)
                pending_models = [
                    PendingCall(
                        call_id,
                        name,
                        args,
                        canonical_call_key(name, args),
                    )
                    for call_id, name, args in executable
                ]
                for call_id, name, args in normalized:
                    yield ToolCallEvent(
                        tool_call_id=call_id,
                        tool_name=name,
                        arguments=args,
                    )

                self._save_state(
                    phase="tools_dispatched",
                    messages=messages,
                    iteration=iterations,
                    pending_calls=pending_models,
                )
                if self._ledger is not None:
                    for call_id, name, args in executable:
                        if self._ledger.lookup(call_id) is None:
                            self._ledger.record_dispatch(call_id, name, args)

                replayed_results: List[Any] = []
                pending_execute: List[tuple[str, str, Dict[str, Any]]] = []
                for call_id, name, args in executable:
                    recorded = None
                    if self._ledger is not None:
                        rec = self._ledger.reconcile_safe(call_id, name, args)
                        if (
                            rec.verdict is Verdict.REPLAY_SKIP
                            and rec.replay_result is not None
                        ):
                            recorded = rec.replay_result
                    if recorded is not None:
                        replayed_results.append((call_id, name, args, recorded, True))
                    else:
                        pending_execute.append((call_id, name, args))

                results = await asyncio.gather(
                    *[
                        self._execute_one_tool(call_id, name, args)
                        for call_id, name, args in pending_execute
                    ],
                    return_exceptions=True,
                )

                for call_id, name, args, content, success in replayed_results:
                    yield await self._append_tool_outcome(
                        messages,
                        call_id,
                        name,
                        args,
                        content,
                        success=success,
                        persist_ledger=False,
                    )

                for (call_id, name, args), result in zip(pending_execute, results):
                    if isinstance(result, BaseException) and not isinstance(
                        result, Exception
                    ):
                        raise result
                    if isinstance(result, BaseException):
                        content = f"ERROR: {result}"
                        success = False
                    else:
                        content = str(result)
                        success = not content.startswith("ERROR:")
                    yield await self._append_tool_outcome(
                        messages,
                        call_id,
                        name,
                        args,
                        content,
                        success=success,
                    )

                loop_check = self.loop_detector.check()
                if loop_check is not None and loop_check.nudge:
                    messages.append(
                        {"role": "system", "content": loop_check.nudge},
                    )
                    yield ErrorEvent(
                        message=loop_check.message,
                        recoverable=True,
                    )

            yield self._finish_final(
                messages,
                iterations,
                "max iterations reached",
                success=False,
            )
        except KeyboardInterrupt:
            raise
        except asyncio.CancelledError:
            if self._run_store is not None:
                current = self._run_store.load()
                if current is not None and current.phase == "tools_dispatched":
                    raise
            yield self._interrupted_event("cancelled", messages, iterations)
            raise

    async def astream(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[AgentEvent]:
        """Run the FC loop, yielding typed events (NFR-4 source of truth)."""
        self._current_query = query
        messages = self._build_messages(query, history)
        async for event in self._loop(messages, start_iteration=0):
            yield event

    async def aresume(
        self,
        state: RunState | None = None,
        *,
        approve_unsafe_replay: bool = False,
    ) -> AsyncIterator[AgentEvent]:
        """Resume an interrupted run from persisted state."""
        if state is None:
            if self._run_store is None:
                raise RuntimeError("aresume() needs a RunState or run_store")
            state = self._run_store.load()
        if state is None:
            raise RuntimeError("no persisted RunState to resume")

        self._stop_requested = False
        self._current_query = state.query
        self._run_id = state.run_id or self._run_id
        if state.created_at:
            self._state_created_at = state.created_at

        if state.phase == "completed":
            output = ""
            for msg in reversed(state.messages):
                if msg.get("role") == "assistant" and not msg.get("tool_calls"):
                    output = msg.get("content") or ""
                    break
            yield FinalEvent(
                output=output,
                success=True,
                messages=list(state.messages),
                iterations=state.iteration,
            )
            return

        messages = list(state.messages)
        if state.phase == "tools_dispatched":
            async for event in self._resume_pending_tools(
                state,
                messages,
                approve_unsafe_replay=approve_unsafe_replay,
            ):
                yield event
            async for event in self._loop(
                messages,
                start_iteration=state.iteration,
            ):
                yield event
            return

        async for event in self._loop(
            messages,
            start_iteration=state.iteration,
            increment_first=False,
        ):
            yield event

    async def _resume_pending_tools(
        self,
        state: RunState,
        messages: List[Dict[str, Any]],
        *,
        approve_unsafe_replay: bool = False,
    ) -> AsyncIterator[AgentEvent]:
        for pending in state.pending_calls:
            already = any(
                row.get("role") == "tool"
                and row.get("tool_call_id") == pending.call_id
                for row in messages
            )
            if already:
                continue
            if self._ledger is None:
                verdict = Verdict.AMBIGUOUS
                replay_result = None
            else:
                reconciliation = self._ledger.reconcile_safe(
                    pending.call_id,
                    pending.tool_name,
                    pending.arguments,
                )
                verdict = reconciliation.verdict
                replay_result = reconciliation.replay_result

            tool = self._registry.get(pending.tool_name)
            effect = (
                tool.resolve_effect_class(pending.arguments)
                if tool is not None
                else "unknown"
            )
            # Resume reconstructs from disk; it is not a live streaming
            # request. Setting request_is_streaming=True here would hard-veto
            # every AMBIGUOUS call (including read tools) before effect_class
            # is considered, which contradicts the resume acceptance cases.
            decision = decide_replay(
                ReplayRequest(
                    call_id=pending.call_id,
                    tool_name=pending.tool_name,
                    arguments=pending.arguments,
                    ledger_verdict=verdict,
                    effect_class=effect,
                    output_already_emitted=state.phase == "completed",
                    request_is_streaming=False,
                    approve_unsafe_replay=approve_unsafe_replay,
                )
            )

            if decision.action == "abort":
                raise ToolCallIdentityError(
                    pending.call_id,
                    recorded_key=pending.canonical_key,
                    incoming_key=canonical_call_key(
                        pending.tool_name, pending.arguments
                    ),
                    changed_fields=(),
                )
            if decision.action == "skip_use_recorded":
                content = (
                    replay_result
                    if replay_result is not None
                    else OUTCOME_UNKNOWN_CONTENT
                )
                yield await self._append_tool_outcome(
                    messages,
                    pending.call_id,
                    pending.tool_name,
                    pending.arguments,
                    content,
                    success=not str(content).startswith("ERROR:"),
                    persist_ledger=False,
                )
                continue
            if decision.action == "mark_unknown":
                content = f"{decision.reason}\n{OUTCOME_UNKNOWN_CONTENT}"
                yield await self._append_tool_outcome(
                    messages,
                    pending.call_id,
                    pending.tool_name,
                    pending.arguments,
                    content,
                    success=False,
                    metadata={
                        "kind": KIND_OUTCOME_UNKNOWN,
                        "veto": decision.veto,
                    },
                    persist_ledger=False,
                )
                continue

            if self._ledger is not None and verdict is Verdict.FRESH:
                self._ledger.record_dispatch(
                    pending.call_id,
                    pending.tool_name,
                    pending.arguments,
                )
            result = await self._execute_one_tool(
                pending.call_id,
                pending.tool_name,
                pending.arguments,
            )
            if isinstance(result, BaseException):
                content = f"ERROR: {result}"
                success = False
            else:
                content = str(result)
                success = not content.startswith("ERROR:")
            yield await self._append_tool_outcome(
                messages,
                pending.call_id,
                pending.tool_name,
                pending.arguments,
                content,
                success=success,
            )

    async def arun(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> ReActResult:
        """Aggregate :meth:`astream` into a :class:`ReActResult` (NFR-4)."""
        events: List[AgentEvent] = []
        output: Any = None
        success = False
        error: Optional[str] = None
        messages: List[Dict[str, Any]] = []
        iterations = 0

        async for event in self.astream(query, history=history):
            events.append(event)
            if isinstance(event, FinalEvent):
                output = event.output
                success = event.success
                messages = list(event.messages)
                iterations = event.iterations
            elif isinstance(event, InterruptedEvent):
                messages = list(event.messages)
                iterations = event.iteration
                success = False
                error = f"interrupted: {event.reason}"
            elif isinstance(event, ErrorEvent) and not event.recoverable:
                error = event.message
                success = False

        if error and not isinstance(events[-1] if events else None, FinalEvent):
            return ReActResult(
                success=False,
                output=output,
                error=error,
                messages=messages,
                iterations=iterations,
                events=events,
            )

        return ReActResult(
            success=success,
            output=output,
            error=error,
            messages=messages,
            iterations=iterations,
            events=events,
        )

    def run(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> ReActResult:
        """Sync convenience wrapper; fails clearly when an event loop is running."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self.arun(query, history=history))
        raise RuntimeError(
            "ReActAgent.run() cannot be called inside a running event loop; "
            "use await agent.arun(...) instead.",
        )
