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
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence

from agenticx.agents.agent_events import (
    AgentEvent,
    ErrorEvent,
    FinalEvent,
    ReasoningEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from agenticx.core.agent_executor import ToolRegistry
from agenticx.core.offload.protocol import Offloader, should_offload
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse
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

    async def astream(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[AgentEvent]:
        """Run the FC loop, yielding typed events (NFR-4 source of truth)."""
        self._stop_requested = False
        messages = self._build_messages(query, history)
        iterations = 0

        try:
            while iterations < self.max_iterations:
                if self._stop_requested:
                    yield ErrorEvent(
                        message="run stopped by user",
                        recoverable=False,
                    )
                    break

                iterations += 1
                yield ReasoningEvent(iteration=iterations)

                messages = await self._maybe_compact(messages)
                response = await self._ainvoke(messages)
                messages.append(self._assistant_message_from_response(response))

                tool_calls = response.tool_calls or []
                if not tool_calls:
                    yield FinalEvent(
                        output=response.content,
                        success=True,
                        messages=list(messages),
                        iterations=iterations,
                    )
                    return

                # Emit tool_call events then execute in parallel.
                pending: List[Dict[str, Any]] = []
                for tc in tool_calls:
                    fn = tc.get("function") or {}
                    name = str(fn.get("name", "") or "")
                    args = _parse_tool_arguments(fn.get("arguments"))
                    tc_id = str(tc.get("id", "") or f"call_{name}_{iterations}")
                    pending.append(tc)
                    yield ToolCallEvent(
                        tool_call_id=tc_id,
                        tool_name=name,
                        arguments=args,
                    )

                results = await asyncio.gather(
                    *[
                        self._execute_one_tool(
                            str(tc.get("id", "") or ""),
                            str((tc.get("function") or {}).get("name", "") or ""),
                            _parse_tool_arguments(
                                (tc.get("function") or {}).get("arguments"),
                            ),
                        )
                        for tc in pending
                    ],
                    return_exceptions=True,
                )

                for tc, result in zip(pending, results):
                    fn = tc.get("function") or {}
                    name = str(fn.get("name", "") or "")
                    tc_id = str(tc.get("id", "") or "")
                    if isinstance(result, BaseException):
                        content = f"ERROR: {result}"
                        success = False
                    else:
                        content = str(result)
                        success = not content.startswith("ERROR:")

                    self.loop_detector.record_call(
                        name,
                        LoopDetector.args_signature(
                            _parse_tool_arguments(fn.get("arguments")),
                        ),
                        has_progress=success,
                        result_fingerprint=LoopDetector.fingerprint_from_result(
                            content,
                        ),
                    )

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": content,
                        },
                    )
                    yield ToolResultEvent(
                        tool_call_id=tc_id,
                        tool_name=name,
                        content=content,
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

            else:
                yield FinalEvent(
                    output="max iterations reached",
                    success=False,
                    messages=list(messages),
                    iterations=iterations,
                )

        except asyncio.CancelledError:
            yield ErrorEvent(message="cancelled", recoverable=False)
            raise

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
