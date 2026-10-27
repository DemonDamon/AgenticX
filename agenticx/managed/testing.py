#!/usr/bin/env python3
"""Scripted LLM doubles for managed-agent tests and demos.

Author: Damon Li
"""

from __future__ import annotations

import copy
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Iterator, Sequence

from agenticx.managed.llm import LLMCallContext


@dataclass
class ScriptStep:
    content: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def tool_call(name: str, arguments: dict[str, Any], call_id: str) -> dict[str, Any]:
    """Return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}."""
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments},
    }


class _ScriptedResponse:
    def __init__(self, content: str, tool_calls: list[dict[str, Any]]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class ScriptedLLM:
    """Thread-safe scripted LLM. After the script is exhausted it returns `fallback_text` with no tools."""

    def __init__(self, steps: Sequence[ScriptStep], *, fallback_text: str = "done") -> None:
        self._steps = list(steps)
        self._fallback_text = fallback_text
        self._index = 0
        self._lock = threading.Lock()
        self.calls: list[dict[str, Any]] = []

    def invoke(self, messages: Any, **kwargs: Any) -> _ScriptedResponse:
        with self._lock:
            if self._index < len(self._steps):
                step = self._steps[self._index]
                self._index += 1
                content = step.content
                tool_calls = copy.deepcopy(step.tool_calls)
            else:
                content = self._fallback_text
                tool_calls = []
            recorded_messages = [dict(item) for item in messages]
            tools_arg = kwargs.get("tools")
            if isinstance(tools_arg, list):
                tool_names = [tool["function"]["name"] for tool in tools_arg]
            else:
                tool_names = []
            self.calls.append({"messages": recorded_messages, "tools": tool_names})
            return _ScriptedResponse(content, tool_calls)

    def stream(self, *args: Any, **kwargs: Any) -> Iterator[str]:
        del args, kwargs
        return iter(())


class StaticLLMFactory:
    """LLMFactory that always returns the same object (one ScriptedLLM shared by all sessions)."""

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        del provider, model, context
        return self._llm


class PerSessionScriptFactory:
    """LLMFactory that builds a fresh ScriptedLLM(steps) per session_id and keeps it in `self.by_session`."""

    def __init__(self, steps: Sequence[ScriptStep], *, fallback_text: str = "done") -> None:
        self._steps = tuple(steps)
        self._fallback_text = fallback_text
        self.by_session: dict[str, ScriptedLLM] = {}

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> ScriptedLLM:
        del provider, model
        existing = self.by_session.get(context.session_id)
        if existing is not None:
            return existing
        llm = ScriptedLLM(self._steps, fallback_text=self._fallback_text)
        self.by_session[context.session_id] = llm
        return llm


def _script_role(context: LLMCallContext) -> str:
    """primary, self, agent:<id>, or advisor."""
    if context.thread_id is None:
        return "primary"
    if context.thread_role == "agent":
        return f"agent:{context.agent_id}"
    if context.thread_role:
        return context.thread_role
    return "primary"


class ThreadScriptFactory:
    """Scripted LLMs keyed by (session_id, role). role = "primary" | "self" | "agent:<agent_id>" | "advisor".

    One ScriptedLLM per (session_id, thread_id or "primary"); scripts are chosen by role.
    """

    def __init__(self, scripts: Mapping[str, Sequence[ScriptStep]], *, fallback_text: str = "done") -> None:
        self._scripts = {key: tuple(steps) for key, steps in scripts.items()}
        self._fallback_text = fallback_text
        self._llms: dict[tuple[str, str], ScriptedLLM] = {}

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> ScriptedLLM:
        del provider, model
        slot = context.thread_id or "primary"
        key = (context.session_id, slot)
        existing = self._llms.get(key)
        if existing is not None:
            return existing
        steps = self._scripts.get(_script_role(context), ())
        llm = ScriptedLLM(steps, fallback_text=self._fallback_text)
        self._llms[key] = llm
        return llm

    def llm_for(self, session_id: str, thread_id: str | None) -> ScriptedLLM | None:
        return self._llms.get((session_id, thread_id or "primary"))


__all__ = [
    "ScriptStep",
    "tool_call",
    "ScriptedLLM",
    "StaticLLMFactory",
    "PerSessionScriptFactory",
    "ThreadScriptFactory",
]
