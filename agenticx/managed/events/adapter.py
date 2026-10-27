#!/usr/bin/env python3
"""Map AgentRuntime events onto Managed Agents server events.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping

from agenticx.managed.events.state_machine import session_error_event
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import StopReasonType, Usage
from agenticx.runtime.agent_runtime import STOP_MESSAGE
from agenticx.runtime.events import EventType, RuntimeEvent

ToolKind = Literal["builtin", "mcp", "custom"]
TOOL_RESULT_MAX_CHARS = 65536
TRUNCATION_SUFFIX = "\n[truncated]"
# Enterprise gateway compliance blocks: business codes 90001 (request) and
# 90002 (response). Provider exceptions may carry the body as JSON, a Python
# repr, or with unicode escapes, so match loosely.
POLICY_BLOCK_RE = re.compile(
    r"code\W{0,6}9000[12]\b|合规拦截|\\u5408\\u89c4\\u62e6\\u622a"
)
# Managed budget guard (agenticx.managed.budget). Kept as a string match so the
# adapter does not depend on how the runtime wraps provider exceptions.
BUDGET_EXCEEDED_RE = re.compile(r"agx_budget_exceeded")


@dataclass
class AnnouncedToolUse:
    """A tool-use event already handed to the ledger, before or after bind."""

    event_id: str
    kind: ToolKind
    name: str
    mcp_server: str | None = None
    tool_call_id: str | None = None


class ToolUseLedger:
    """FIFO of hook-announced tool uses, bound later to runtime tool_call ids.

    Tools in one round run serially, so the unbound head is the next call.
    ``reset_turn`` drops unbound leftovers only. Bound entries stay so a custom
    tool can remain in flight until its runtime ``tool_result`` arrives.
    ``by_call_id`` still returns a finished use; callers should ``finish`` once.
    """

    def __init__(self) -> None:
        self._unbound: list[AnnouncedToolUse] = []
        self._by_call: dict[str, AnnouncedToolUse] = {}
        self._finished: set[str] = set()
        self._bind_order: list[str] = []

    def record(self, use: AnnouncedToolUse) -> None:
        """Append ``use`` to the unbound FIFO."""
        self._unbound.append(use)

    def bind(self, tool_call_id: str, name: str) -> AnnouncedToolUse | None:
        """Pop the FIFO head when its name matches and index it by call id."""
        if not self._unbound:
            return None
        head = self._unbound[0]
        if head.name != name:
            return None
        self._unbound.pop(0)
        head.tool_call_id = tool_call_id
        self._by_call[tool_call_id] = head
        self._bind_order.append(tool_call_id)
        return head

    def latest_bound_event_id(self, name: str) -> str | None:
        """Event id of the most recently bound use with this name, finished or not.

        With parallel tool calls, two uses of the same name can bind out of
        order. The id is informational on background tasks.
        """
        for tool_call_id in reversed(self._bind_order):
            use = self._by_call.get(tool_call_id)
            if use is not None and use.name == name:
                return use.event_id
        return None

    def by_call_id(self, tool_call_id: str) -> AnnouncedToolUse | None:
        return self._by_call.get(tool_call_id)

    def inflight_custom(self, name: str) -> str | None:
        """Event id of the newest bound, unfinished custom use with this name."""
        found: str | None = None
        for use in self._by_call.values():
            if use.kind != "custom" or use.name != name:
                continue
            if use.tool_call_id is None or use.tool_call_id in self._finished:
                continue
            found = use.event_id
        return found

    def finish(self, tool_call_id: str) -> None:
        """Mark a bound call finished so ``inflight_custom`` skips it."""
        self._finished.add(tool_call_id)

    def reset_turn(self) -> None:
        """Drop unbound FIFO leftovers. Bound calls are kept."""
        self._unbound.clear()


@dataclass
class AdapterOutput:
    """Events to persist and preview frames that must not be stored."""

    events: list[dict[str, Any]] = field(default_factory=list)
    previews: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class TurnOutcome:
    """Terminal view of one model turn. Status events are not included."""

    stop_type: StopReasonType
    events: list[dict[str, Any]]
    usage: Usage


class RuntimeEventAdapter:
    """Translate one runtime turn into server events and preview frames.

    Call ``begin_turn`` before events and ``finish_turn`` after. ``finish_turn``
    is not idempotent. An open span dropped by a second ``begin_turn`` does not
    emit ``span.model_request_end``; call ``finish_turn`` first.

    ``build_tool_use`` is shared with the permission hook. The hook must persist
    the returned events itself. A later ``tool_call`` only binds the ledger and
    does not emit a second tool-use event. Span ends emitted for a tool call use
    a zero ``model_usage``; turn totals come from the last ``final`` event.
    ``usage.tool_calls`` counts runtime ``tool_call`` events, not hook announces.
    """

    def __init__(
        self,
        *,
        model_ref: str,
        kind_of: Callable[[str], ToolKind | None],
        ledger: ToolUseLedger | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._model_ref = model_ref
        self._kind_of = kind_of
        self._ledger = ledger if ledger is not None else ToolUseLedger()
        self._clock = clock
        self._span_open = False
        self._message_started = False
        self._stashed_error: dict[str, str] | None = None
        self._interrupted = False
        self._rounds_exhausted = False
        self._policy_blocked = False
        self._budget_exceeded = False
        self._saw_final = False
        self._tool_calls = 0
        self._turn_usage = Usage()
        self._last_request_usage = Usage()
        self._started_at = 0.0
        self._base_usage = Usage()

    @property
    def ledger(self) -> ToolUseLedger:
        return self._ledger

    def begin_turn(self, base_usage: Usage) -> None:
        """Reset per-turn flags and snapshot ``base_usage``."""
        self._span_open = False
        self._message_started = False
        self._stashed_error = None
        self._interrupted = False
        self._rounds_exhausted = False
        self._policy_blocked = False
        self._budget_exceeded = False
        self._saw_final = False
        self._tool_calls = 0
        self._turn_usage = Usage()
        self._last_request_usage = Usage()
        self._started_at = self._clock()
        self._base_usage = Usage(
            input_tokens=base_usage.input_tokens,
            output_tokens=base_usage.output_tokens,
            cache_read_input_tokens=base_usage.cache_read_input_tokens,
            tool_calls=base_usage.tool_calls,
            runtime_ms=base_usage.runtime_ms,
        )
        self._ledger.reset_turn()

    def build_tool_use(
        self,
        *,
        kind: ToolKind,
        name: str,
        input: Mapping[str, Any],
        evaluated_policy: Literal["always_allow", "always_ask"] | None,
        mcp_server: str | None = None,
        ledger_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """Close an open model span and announce one tool use.

        Keys starting with ``__`` are stripped. ``mcp_server`` is required for
        ``kind="mcp"``; None is stored as an empty string. ``ledger_name``
        binds the announce to a runtime function name that differs from the
        event name (MCP).
        """
        cleaned = {
            key: value
            for key, value in input.items()
            if not str(key).startswith("__")
        }
        safe_input = json.loads(json.dumps(cleaned, ensure_ascii=False, default=str))
        if not isinstance(safe_input, dict):
            safe_input = {}
        events = self._close_span()
        event_id = new_ulid()
        policy = evaluated_policy or "always_allow"
        if kind == "builtin":
            tool_event: dict[str, Any] = {
                "id": event_id,
                "type": "agent.tool_use",
                "name": name,
                "input": safe_input,
                "evaluated_policy": policy,
            }
        elif kind == "mcp":
            tool_event = {
                "id": event_id,
                "type": "agent.mcp_tool_use",
                "mcp_server": mcp_server if mcp_server is not None else "",
                "name": name,
                "input": safe_input,
                "evaluated_policy": policy,
            }
        elif kind == "custom":
            tool_event = {
                "id": event_id,
                "type": "agent.custom_tool_use",
                "name": name,
                "input": safe_input,
            }
        else:
            raise ValueError(f"unknown tool kind: {kind}")
        self._ledger.record(
            AnnouncedToolUse(
                event_id=event_id,
                kind=kind,
                name=ledger_name or name,
                mcp_server=mcp_server,
            )
        )
        events.append(tool_event)
        return events

    def convert(self, event: RuntimeEvent) -> AdapterOutput:
        """Map one runtime event. Unknown types produce an empty output."""
        out = AdapterOutput()
        event_type = event.type
        data = event.data
        if event_type == EventType.ROUND_START.value:
            return self._on_round_start(out)
        if event_type == EventType.TOKEN.value:
            return self._on_token(out, data)
        if event_type == EventType.TOOL_CALL.value:
            return self._on_tool_call(out, data)
        if event_type == EventType.TOOL_RESULT.value:
            return self._on_tool_result(out, data)
        if event_type == EventType.FINAL.value:
            return self._on_final(out, data)
        if event_type == EventType.ERROR.value:
            return self._on_error(out, data)
        if event_type == EventType.SUBAGENT_PAUSED.value:
            self._rounds_exhausted = True
        return out

    def mark_interrupted(self) -> None:
        """Record a forced cancel. Equivalent stop semantics to STOP_MESSAGE.

        The matching ``span.model_request_end`` is emitted by ``finish_turn``,
        because this method returns None. Pass ``error=None`` to ``finish_turn``
        so a cancellation is not also reported as ``internal_error``.
        """
        self._interrupted = True

    def finish_turn(self, *, error: BaseException | None = None) -> TurnOutcome:
        """Close the turn, emit usage, and choose the stop reason."""
        events: list[dict[str, Any]] = []
        fatal = error is not None or self._stashed_error is not None
        if self._span_open:
            events.extend(self._close_span(is_error=fatal and not self._interrupted))
        if error is not None:
            error_text = f"{type(error).__name__}: {error}"[:500]
            if POLICY_BLOCK_RE.search(str(error)):
                self._policy_blocked = True
                events.append(session_error_event("policy_blocked", error_text, "terminal"))
            elif BUDGET_EXCEEDED_RE.search(str(error)):
                self._budget_exceeded = True
                events.append(session_error_event("budget_exceeded", error_text, "terminal"))
            else:
                events.append(session_error_event("internal_error", error_text, "exhausted"))
        elif self._stashed_error is not None and not self._interrupted:
            stashed = self._stashed_error
            retry = "terminal" if stashed["type"] in ("policy_blocked", "budget_exceeded") else "exhausted"
            events.append(session_error_event(stashed["type"], stashed["message"], retry))
        if self._interrupted:
            self._stashed_error = None
        if self._interrupted:
            stop_type: StopReasonType = "end_turn"
        elif self._rounds_exhausted:
            stop_type = "max_tool_rounds"
        elif self._policy_blocked:
            stop_type = "policy_blocked"
        elif self._budget_exceeded:
            stop_type = "budget_exceeded"
        elif fatal:
            stop_type = "retries_exhausted"
        else:
            stop_type = "end_turn"
        elapsed_ms = int((self._clock() - self._started_at) * 1000)
        if elapsed_ms < 0:
            elapsed_ms = 0
        usage = Usage(
            input_tokens=self._base_usage.input_tokens + self._turn_usage.input_tokens,
            output_tokens=self._base_usage.output_tokens + self._turn_usage.output_tokens,
            cache_read_input_tokens=(
                self._base_usage.cache_read_input_tokens
                + self._turn_usage.cache_read_input_tokens
            ),
            tool_calls=(
                self._base_usage.tool_calls + self._turn_usage.tool_calls + self._tool_calls
            ),
            runtime_ms=self._base_usage.runtime_ms + self._turn_usage.runtime_ms + elapsed_ms,
        )
        events.append({"id": new_ulid(), "type": "session.usage", "usage": usage.model_dump()})
        return TurnOutcome(stop_type=stop_type, events=events, usage=usage)

    def _on_round_start(self, out: AdapterOutput) -> AdapterOutput:
        out.events.extend(self._flush_stashed())
        out.events.extend(self._close_span())
        out.events.append(
            {
                "id": new_ulid(),
                "type": "span.model_request_start",
                "model": self._model_ref,
            }
        )
        self._span_open = True
        self._message_started = False
        return out

    def _on_token(self, out: AdapterOutput, data: Mapping[str, Any]) -> AdapterOutput:
        text = data["text"]
        if not isinstance(text, str):
            text = str(text)
        if text == "":
            return out
        if not self._message_started:
            out.previews.append({"type": "event_start", "event": {"type": "agent.message"}})
            self._message_started = True
        out.previews.append(
            {"type": "event_delta", "event_type": "agent.message", "content_delta": text}
        )
        return out

    def _on_tool_call(self, out: AdapterOutput, data: Mapping[str, Any]) -> AdapterOutput:
        out.events.extend(self._flush_stashed())
        self._tool_calls += 1
        name = str(data.get("name") or "")
        tool_call_id = str(data.get("tool_call_id") or "")
        raw_input = data.get("arguments") or {}
        arguments: Mapping[str, Any] = raw_input if isinstance(raw_input, Mapping) else {}
        use = self._ledger.bind(tool_call_id, name)
        if use is None:
            kind = self._kind_of(name) or "builtin"
            policy: Literal["always_allow", "always_ask"] | None
            policy = None if kind == "custom" else "always_allow"
            mcp_server = data.get("mcp_server")
            out.events.extend(
                self.build_tool_use(
                    kind=kind,
                    name=name,
                    input=arguments,
                    evaluated_policy=policy,
                    mcp_server=mcp_server if isinstance(mcp_server, str) else None,
                )
            )
            self._ledger.bind(tool_call_id, name)
        else:
            out.events.extend(self._close_span())
        return out

    def _on_tool_result(self, out: AdapterOutput, data: Mapping[str, Any]) -> AdapterOutput:
        out.events.extend(self._flush_stashed())
        tool_call_id = str(data.get("tool_call_id") or "")
        use = self._ledger.by_call_id(tool_call_id)
        if use is None:
            return out
        text = _truncate_result(str(data.get("result", "")))
        is_error = bool(data.get("is_error")) or text.startswith(("ERROR:", "CANCELLED:"))
        content: list[dict[str, str]] = [{"type": "text", "text": text}] if text else []
        if use.kind == "builtin":
            out.events.append(
                {
                    "id": new_ulid(),
                    "type": "agent.tool_result",
                    "tool_use_id": use.event_id,
                    "content": content,
                    "is_error": is_error,
                }
            )
        elif use.kind == "mcp":
            out.events.append(
                {
                    "id": new_ulid(),
                    "type": "agent.mcp_tool_result",
                    "mcp_tool_use_id": use.event_id,
                    "content": content,
                    "is_error": is_error,
                }
            )
        self._ledger.finish(tool_call_id)
        return out

    def _on_final(self, out: AdapterOutput, data: Mapping[str, Any]) -> AdapterOutput:
        out.events.extend(self._flush_stashed())
        self._saw_final = True
        request_usage, turn_usage = _usages_from_metadata(data.get("usage_metadata"))
        self._last_request_usage = request_usage
        self._turn_usage = turn_usage
        out.events.extend(self._close_span(model_usage=request_usage))
        reasoning = data.get("reasoning")
        if isinstance(reasoning, str) and reasoning:
            out.events.append(
                {
                    "id": new_ulid(),
                    "type": "agent.thinking",
                    "content": [{"type": "text", "text": reasoning}],
                }
            )
        text = data.get("text")
        if isinstance(text, str) and text:
            out.events.append(
                {
                    "id": new_ulid(),
                    "type": "agent.message",
                    "content": [{"type": "text", "text": text}],
                }
            )
        return out

    def _on_error(self, out: AdapterOutput, data: Mapping[str, Any]) -> AdapterOutput:
        text = data.get("text")
        if text == STOP_MESSAGE:
            self._interrupted = True
            out.events.extend(self._close_span(is_error=False))
            return out
        if data.get("tool_call_id"):
            return out
        if data.get("rounds_exhausted") is True:
            self._rounds_exhausted = True
            out.events.extend(self._close_span())
            return out
        severity = data.get("severity") or "error"
        detector = data.get("detector")
        error_type = detector if isinstance(detector, str) and detector else None
        message = text if isinstance(text, str) else ""
        if severity == "warning":
            if data.get("retryable") is True:
                out.events.append(
                    session_error_event(error_type or "runtime_warning", message, "retrying")
                )
            return out
        out.events.extend(self._flush_stashed())
        if POLICY_BLOCK_RE.search(message):
            self._policy_blocked = True
            error_type = "policy_blocked"
        elif BUDGET_EXCEEDED_RE.search(message):
            self._budget_exceeded = True
            error_type = "budget_exceeded"
        self._stashed_error = {
            "type": error_type or "runtime_error",
            "message": message,
        }
        return out

    def _flush_stashed(self) -> list[dict[str, Any]]:
        stashed = self._stashed_error
        if stashed is None:
            return []
        self._stashed_error = None
        return [session_error_event(stashed["type"], stashed["message"], "retrying")]

    def _close_span(
        self,
        is_error: bool = False,
        model_usage: Usage | None = None,
    ) -> list[dict[str, Any]]:
        if not self._span_open:
            return []
        usage = model_usage if model_usage is not None else Usage()
        self._span_open = False
        return [
            {
                "id": new_ulid(),
                "type": "span.model_request_end",
                "model": self._model_ref,
                "is_error": is_error,
                "model_usage": usage.model_dump(),
            }
        ]


def _truncate_result(text: str) -> str:
    if len(text) <= TOOL_RESULT_MAX_CHARS:
        return text
    return text[:TOOL_RESULT_MAX_CHARS] + TRUNCATION_SUFFIX


def _nonneg(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return number


def _usages_from_metadata(raw: Any) -> tuple[Usage, Usage]:
    meta: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    request = Usage(
        input_tokens=_nonneg(meta.get("input_tokens", 0)),
        output_tokens=_nonneg(meta.get("output_tokens", 0)),
        cache_read_input_tokens=_nonneg(meta.get("cached_tokens", 0)),
    )

    def turn_value(key: str, fallback: int) -> int:
        if key not in meta or meta.get(key) is None:
            return fallback
        return _nonneg(meta.get(key))

    turn = Usage(
        input_tokens=turn_value("turn_input_tokens", request.input_tokens),
        output_tokens=turn_value("turn_output_tokens", request.output_tokens),
        cache_read_input_tokens=turn_value("turn_cached_tokens", request.cache_read_input_tokens),
    )
    return request, turn
