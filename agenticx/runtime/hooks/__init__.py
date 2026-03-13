#!/usr/bin/env python3
"""Hook and middleware abstractions for AgentRuntime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass
class HookOutcome:
    """Result for before_tool_call interception."""

    blocked: bool = False
    reason: str = ""


class AgentHook:
    """Base hook class.

    Subclasses can selectively override lifecycle methods.
    """

    async def before_model(self, messages: Sequence[Dict[str, Any]], session: Any) -> Optional[Sequence[Dict[str, Any]]]:
        return None

    async def after_model(self, response: Any, session: Any) -> None:
        return None

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session: Any,
    ) -> Optional[HookOutcome]:
        return None

    async def after_tool_call(
        self,
        tool_name: str,
        result: str,
        session: Any,
    ) -> Optional[str]:
        return None

    async def on_compaction(
        self,
        compacted_count: int,
        summary: str,
        session: Any,
    ) -> None:
        return None

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        return None


class HookRegistry:
    """Registry and dispatcher for runtime hooks."""

    def __init__(self) -> None:
        self._entries: List[Tuple[int, AgentHook]] = []

    def register(self, hook: AgentHook, *, priority: int = 0) -> None:
        self._entries.append((priority, hook))
        self._entries.sort(key=lambda item: item[0], reverse=True)

    def has_hooks(self) -> bool:
        return bool(self._entries)

    async def run_before_model(
        self,
        messages: Sequence[Dict[str, Any]],
        session: Any,
    ) -> List[Dict[str, Any]]:
        current: List[Dict[str, Any]] = list(messages)
        for _, hook in self._entries:
            updated = await hook.before_model(current, session)
            if updated is not None:
                current = list(updated)
        return current

    async def run_after_model(self, response: Any, session: Any) -> None:
        for _, hook in self._entries:
            await hook.after_model(response, session)

    async def run_before_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session: Any,
    ) -> HookOutcome:
        for _, hook in self._entries:
            outcome = await hook.before_tool_call(tool_name, arguments, session)
            if outcome is not None and outcome.blocked:
                return outcome
        return HookOutcome(blocked=False, reason="")

    async def run_after_tool_call(
        self,
        tool_name: str,
        result: str,
        session: Any,
    ) -> str:
        current = result
        for _, hook in self._entries:
            updated = await hook.after_tool_call(tool_name, current, session)
            if isinstance(updated, str):
                current = updated
        return current

    async def run_on_compaction(self, compacted_count: int, summary: str, session: Any) -> None:
        for _, hook in self._entries:
            await hook.on_compaction(compacted_count, summary, session)

    async def run_on_agent_end(self, final_text: str, session: Any) -> None:
        for _, hook in self._entries:
            await hook.on_agent_end(final_text, session)
