#!/usr/bin/env python3
"""Action broker protocol and the caller-executed custom tool resolver.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from agenticx.managed.events.state_machine import ActionKind
from agenticx.managed.protocol import ClientEvent, UserCustomToolResult
from agenticx.managed.spec import ToolKind, ToolPolicy
from agenticx.tools.fallback_chain import ToolResolver


@runtime_checkable
class ActionBroker(Protocol):
    """Bridge between in-runtime hooks and the session event log.

    Implemented by MA-A04 (SessionActor, cloud) and MA-A05 (RemoteActionBroker,
    desktop worker).
    """

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
        """Persist a tool-use event and return its id.

        The event type is ``agent.tool_use``, ``agent.mcp_tool_use``, or
        ``agent.custom_tool_use`` depending on ``kind``.
        """
        ...

    async def request_action(
        self,
        event_id: str,
        kind: ActionKind,
    ) -> ClientEvent | None:
        """Move the session to requires_action and wait for a resolution.

        Returns the resolving ``UserToolConfirmation`` or
        ``UserCustomToolResult``, or None when ``user.interrupt`` voids the wait.
        """
        ...

    def custom_tool_use_id(self, name: str) -> str | None:
        """Event id of the in-flight ``agent.custom_tool_use`` for ``name``."""
        ...


def _field(block: Any, key: str) -> Any:
    if isinstance(block, Mapping):
        return block.get(key)
    if isinstance(block, (str, bytes)):
        return None
    return getattr(block, key, None)


def _render_block(block: Any) -> str | None:
    kind = _field(block, "type")
    if not isinstance(kind, str):
        return None
    if kind == "text":
        text = _field(block, "text")
        return text if isinstance(text, str) else ""
    if kind == "image":
        return "[image omitted]"
    if kind != "document":
        return None
    title = _field(block, "title")
    source = _field(block, "source")
    source_type = _field(source, "type") if source is not None else None
    if source_type == "text":
        body = _field(source, "text")
        body_text = body if isinstance(body, str) else ""
        header = "[document]" if title is None else f"[document: {title}]"
        return f"{header}\n{body_text}"
    if source_type == "file":
        return f"[document file: {_field(source, 'file_id')}]"
    return None


def render_content_text(blocks: Sequence[Any]) -> str:
    """Flatten MA content blocks into the text a tool result can carry."""
    parts: list[str] = []
    for block in blocks:
        rendered = _render_block(block)
        if rendered is not None:
            parts.append(rendered)
    return "\n".join(parts).strip()


class CustomToolResolver(ToolResolver):
    """Run a manifest custom tool by waiting on the caller's resolution."""

    def __init__(
        self,
        *,
        broker: ActionBroker,
        custom_tool_names: frozenset[str],
    ) -> None:
        self._broker = broker
        self._names = frozenset(custom_tool_names)

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self._names

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        """Wait for ``user.custom_tool_result`` and render it as tool text.

        ``dispatch_tool_async`` injects ``__tool_call_id`` and ``__agent_id``.
        Those arguments are already on the announced custom-tool-use event, so
        this method ignores ``kwargs``. Exceptions stay inside the resolver:
        ``ToolFallbackChain`` would otherwise turn them into ``unknown tool``.
        """
        del kwargs
        try:
            return await self._resolve_announced(task_intent)
        except Exception as exc:
            return f"ERROR: custom tool bridge failed: {type(exc).__name__}"

    async def _resolve_announced(self, task_intent: str) -> str:
        event_id = self._broker.custom_tool_use_id(task_intent)
        if event_id is None:
            return "ERROR: custom tool use was not announced"
        resolution = await self._broker.request_action(event_id, "custom_tool_result")
        if resolution is None:
            return "CANCELLED: interrupted while waiting for custom tool result"
        if not isinstance(resolution, UserCustomToolResult):
            return "ERROR: unexpected custom tool resolution"
        text = render_content_text(resolution.content)
        if resolution.is_error:
            return f"ERROR: {text or 'custom tool failed'}"
        return text or "(empty result)"


__all__ = [
    "ActionBroker",
    "render_content_text",
    "CustomToolResolver",
]
