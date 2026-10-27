#!/usr/bin/env python3
"""Per-session turn extensions for the managed host.

MA-A06 introduces this protocol. MA-A07 registers another factory on the same
``SessionService``; factories run once per actor, then ``before_turn`` /
``after_turn`` on every turn.

Author: Damon Li
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Literal, Protocol, Sequence

from agenticx.runtime.hooks import AgentHook, HookOutcome
from agenticx.runtime.session_boundary import EgressGuard
from agenticx.tools.fallback_chain import ToolResolver

if TYPE_CHECKING:  # import cycle: actor imports this module
    from agenticx.managed.builder import ManagedRuntimeBundle
    from agenticx.managed.host.actor import SessionActor
    from agenticx.managed.redaction import SecretRedactor

logger = logging.getLogger(__name__)


class TurnSetupError(Exception):
    """Raised by an extension when the turn must not start.

    ``error_type`` is copied into ``session.error``. The message must not
    contain secret material.
    """

    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


@dataclass
class TurnContribution:
    """What one extension adds to the turn that is about to start."""

    hooks: list[AgentHook] = field(default_factory=list)
    tool_schemas: list[dict[str, Any]] = field(default_factory=list)
    resolvers: list[ToolResolver] = field(default_factory=list)
    system_prompt_suffix: str = ""
    command_env: dict[str, str] = field(default_factory=dict)
    command_network: Literal["inherit", "deny"] = "inherit"
    egress_guard: EgressGuard | None = None
    redactor: SecretRedactor | None = None
    events: list[dict[str, Any]] = field(default_factory=list)


class SessionExtension(Protocol):
    """Hook a managed session at turn boundaries.

    ``before_turn`` may raise ``TurnSetupError`` to skip the model call.
    ``after_turn`` returns extra server events (already safe to persist).
    ``close`` runs when the actor is dropped.
    """

    name: str

    async def before_turn(self, bundle: ManagedRuntimeBundle) -> TurnContribution: ...

    async def after_turn(self, bundle: ManagedRuntimeBundle) -> list[dict[str, Any]]: ...

    async def close(self) -> None: ...


SessionExtensionFactory = Callable[["SessionActor"], Awaitable["SessionExtension | None"]]


class CompositeToolResolver(ToolResolver):
    """First delegate whose ``can_handle`` is true wins. ``resolve`` never raises."""

    def __init__(self, delegates: Sequence[ToolResolver]) -> None:
        self._delegates = list(delegates)

    async def can_handle(self, task_intent: str) -> bool:
        for delegate in self._delegates:
            try:
                if await delegate.can_handle(task_intent):
                    return True
            except Exception as exc:
                logger.error(
                    "tool resolver can_handle failed tool=%s exc=%s",
                    task_intent,
                    type(exc).__name__,
                )
        return False

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        for delegate in self._delegates:
            try:
                if not await delegate.can_handle(task_intent):
                    continue
            except Exception as exc:
                logger.error(
                    "tool resolver can_handle failed tool=%s exc=%s",
                    task_intent,
                    type(exc).__name__,
                )
                continue
            try:
                return await delegate.resolve(task_intent, **kwargs)
            except Exception as exc:
                # Exception text can carry a secret. Log the type only.
                logger.error(
                    "tool resolver failed tool=%s exc=%s",
                    task_intent,
                    type(exc).__name__,
                )
                return f"ERROR: tool {task_intent} failed"
        return f"ERROR: unknown tool '{task_intent}'"


class DynamicToolResolver(ToolResolver):
    """Holds per-turn delegates. ``set`` replaces them at each turn start."""

    def __init__(self) -> None:
        self._inner = CompositeToolResolver(())

    def set(self, delegates: Sequence[ToolResolver]) -> None:
        self._inner = CompositeToolResolver(delegates)

    async def can_handle(self, task_intent: str) -> bool:
        return await self._inner.can_handle(task_intent)

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        return await self._inner.resolve(task_intent, **kwargs)


class DynamicHook(AgentHook):
    """Forwards tool-call hooks to the current turn's hooks, in order."""

    def __init__(self) -> None:
        self._hooks: list[AgentHook] = []

    def set(self, hooks: Sequence[AgentHook]) -> None:
        self._hooks = list(hooks)

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: Any,
    ) -> HookOutcome | None:
        for hook in self._hooks:
            outcome = await hook.before_tool_call(tool_name, arguments, session)
            if outcome is not None and outcome.blocked:
                return outcome
        return None

    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None:
        current = result
        for hook in self._hooks:
            updated = await hook.after_tool_call(tool_name, current, session)
            if isinstance(updated, str):
                current = updated
        return current


__all__ = [
    "CompositeToolResolver",
    "DynamicHook",
    "DynamicToolResolver",
    "SessionExtension",
    "SessionExtensionFactory",
    "TurnContribution",
    "TurnSetupError",
]
