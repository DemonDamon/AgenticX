#!/usr/bin/env python3
"""Deterministic in-process fault injection for the reliability bench.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Union

from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage
from agenticx.tools.base import BaseTool


class FaultKind(str, Enum):
    """Where a deterministic fault is injected during one run."""

    KILL_BEFORE_TOOL_RESULT = "kill_before_tool_result"
    KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST = "kill_after_tool_result_before_persist"
    PERSIST_FAILURE = "persist_failure"
    LLM_TIMEOUT_MID_STREAM = "llm_timeout_mid_stream"
    DUPLICATE_TOOL_CALL_ID = "duplicate_tool_call_id"
    CHANGED_ARGS_SAME_ID = "changed_args_same_id"


class _InjectedCrash(BaseException):
    """Simulated process death.

    Deliberately derives from BaseException, not Exception, so that ordinary
    ``except Exception`` handlers inside the agent cannot swallow it — a real
    process kill is not catchable either.
    """


_KIND_BOUNDARIES = {
    FaultKind.KILL_BEFORE_TOOL_RESULT: "before_tool_result",
    FaultKind.KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST: "after_result",
    FaultKind.PERSIST_FAILURE: "persist",
    FaultKind.LLM_TIMEOUT_MID_STREAM: "llm",
}


@dataclass(frozen=True)
class FaultSpec:
    kind: FaultKind
    #: 1-based index of the tool call at which to fire (0 = fire on the first
    #: matching boundary regardless of index).
    at_call_index: int = 1
    #: Fire only when the dispatched tool has this name; None = any tool.
    tool_name: str | None = None


class FaultInjector:
    """Deterministic, single-shot fault injection around a ReActAgent run."""

    def __init__(self, spec: FaultSpec) -> None:
        self.spec = spec
        self._fired = False
        self._lock = threading.Lock()

    def should_fire(self, *, boundary: str, call_index: int, tool_name: str) -> bool:
        """True at most once per injector instance."""
        with self._lock:
            if self._fired:
                return False
            expected = _KIND_BOUNDARIES.get(self.spec.kind)
            if expected is not None and boundary != expected:
                return False
            if self.spec.tool_name is not None and tool_name != self.spec.tool_name:
                return False
            if self.spec.at_call_index and call_index != self.spec.at_call_index:
                return False
            self._fired = True
            return True

    @property
    def fired(self) -> bool:
        return self._fired


class SideEffectCounter:
    """Process-local, deterministic side-effect ledger used as the bench oracle.

    A "side effect" here is one append to ``self.records``. Because the bench
    runs offline with no real external calls, this counter IS the ground truth
    for "did we do it twice".

    Read-class tools append to ``self.reads`` instead: replaying a read is
    expected and must not inflate ``duplicate_count``.
    """

    def __init__(self) -> None:
        self.records: list[tuple[str, str]] = []
        self.reads: list[tuple[str, str]] = []
        self._lock = threading.Lock()

    def apply(self, op_key: str, payload: dict) -> str:
        """Record one effect and return a deterministic result string."""
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()[:16]
        with self._lock:
            self.records.append((op_key, digest))
            return f"count={len(self.records)}"

    def note_read(self, op_key: str, payload: dict) -> str:
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()[:16]
        with self._lock:
            self.reads.append((op_key, digest))
            return f"read={len(self.reads)}"

    @property
    def duplicate_count(self) -> int:
        """Number of records beyond the first for any repeated op_key."""
        counts = Counter(key for key, _digest in self.records)
        return sum(max(0, n - 1) for n in counts.values())


class CountingTool(BaseTool):
    """BaseTool wrapper around SideEffectCounter, used by bench cases.

    ``effect_class`` is settable per instance so one case can exercise the
    read / local_write / external_write / unknown branches of
    agenticx.reliability.replay_policy.
    """

    def __init__(
        self,
        counter: SideEffectCounter,
        *,
        effect_class: str = "external_write",
        injector: FaultInjector | None = None,
        name: str = "bump",
    ) -> None:
        super().__init__(name=name, description="Deterministic side-effect oracle.")
        self.counter = counter
        self.effect_class = effect_class
        self._injector = injector
        self._call_index = 0
        self._index_lock = threading.Lock()

    def _run(self, **kwargs: Any) -> str:
        with self._index_lock:
            self._call_index += 1
            call_index = self._call_index
        key = str(kwargs.get("key", "") or "")
        if self.effect_class == "read":
            result = self.counter.note_read(key, kwargs)
        else:
            result = self.counter.apply(key, kwargs)
        if self._injector is not None and self._injector.should_fire(
            boundary="before_tool_result",
            call_index=call_index,
            tool_name=self.name,
        ):
            raise _InjectedCrash("kill_before_tool_result")
        return result


class ScriptedFakeLLM(BaseLLMProvider):
    """Offline LLM that returns a predetermined tool-call script."""

    model: str = "fake-reliability"

    def __init__(
        self,
        script: list[list[dict[str, Any]]],
        *,
        injector: FaultInjector | None = None,
        inject_tool_name: str = "bump",
        **data: Any,
    ):
        super().__init__(**data)
        object.__setattr__(self, "_script", list(script))
        object.__setattr__(self, "_idx", 0)
        object.__setattr__(self, "_injector", injector)
        object.__setattr__(self, "_inject_tool_name", inject_tool_name)

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict[str, Any]]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        injector = object.__getattribute__(self, "_injector")
        if injector is not None and injector.should_fire(
            boundary="llm",
            call_index=1,
            tool_name=object.__getattribute__(self, "_inject_tool_name"),
        ):
            raise asyncio.TimeoutError(
                f"{object.__getattribute__(self, '_inject_tool_name')} llm timeout mid-stream"
            )
        script = object.__getattribute__(self, "_script")
        if isinstance(prompt, list):
            idx = sum(
                1
                for msg in prompt
                if isinstance(msg, dict)
                and msg.get("role") == "assistant"
                and msg.get("tool_calls")
            )
        else:
            idx = object.__getattribute__(self, "_idx")
            object.__setattr__(self, "_idx", idx + 1)
        if idx >= len(script):
            return _final_response("fallback")
        return _round_to_response(script[idx])

    def invoke(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    def stream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    async def astream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError


def _round_to_response(round_items: list[dict[str, Any]]) -> LLMResponse:
    for item in round_items:
        if "final" in item:
            return _final_response(str(item.get("final") or ""))
    calls: list[dict[str, Any]] = []
    for item in round_items:
        calls.append(
            {
                "id": str(item.get("id", "") or ""),
                "type": "function",
                "function": {
                    "name": str(item.get("name", "") or ""),
                    "arguments": json.dumps(item.get("arguments") or {}, ensure_ascii=False),
                },
            }
        )
    return LLMResponse(
        id="scripted-tools",
        model_name="fake-reliability",
        created=0,
        content="",
        choices=[],
        token_usage=TokenUsage(),
        tool_calls=calls,
    )


def _final_response(text: str) -> LLMResponse:
    return LLMResponse(
        id="scripted-final",
        model_name="fake-reliability",
        created=0,
        content=text,
        choices=[LLMChoice(index=0, content=text)],
        token_usage=TokenUsage(),
    )
