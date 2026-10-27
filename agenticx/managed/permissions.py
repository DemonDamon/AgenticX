#!/usr/bin/env python3
"""Manifest and enterprise tool permission decisions for managed sessions.

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from agenticx.managed.actions import ActionBroker
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import UserToolConfirmation
from agenticx.managed.spec import AgentSpec, ToolPolicy
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.enterprise_agent_policy import (
    EnterpriseAgentPolicy,
    enterprise_ask_subject,
    enterprise_denied_subject,
)
from agenticx.runtime.hooks import AgentHook, HookOutcome

Decision = Literal["allow", "ask", "deny"]
DecisionSource = Literal["custom", "manifest", "enterprise", "unlisted", "platform"]


@dataclass(frozen=True)
class PermissionDecision:
    """One tool-call decision. Deny outranks ask, and ask outranks allow."""

    decision: Decision
    evaluated_policy: ToolPolicy
    source: DecisionSource
    subject: str | None
    reason: str


def _decision(
    decision: Decision,
    source: DecisionSource,
    subject: str | None,
    reason: str,
) -> PermissionDecision:
    policy: ToolPolicy = "always_allow" if decision == "allow" else "always_ask"
    return PermissionDecision(
        decision=decision,
        evaluated_policy=policy,
        source=source,
        subject=subject,
        reason=reason,
    )


class PermissionEngine:
    """Merge an AgentSpec with an enterprise policy. Does not read local config."""

    def __init__(
        self,
        spec: AgentSpec,
        enterprise_policy: EnterpriseAgentPolicy | None = None,
        platform_tools: frozenset[str] = frozenset(),
    ) -> None:
        self._spec = spec
        if enterprise_policy is None:
            enterprise_policy = EnterpriseAgentPolicy()
        self._enterprise_policy = enterprise_policy
        self._platform_tools = platform_tools

    @property
    def spec(self) -> AgentSpec:
        return self._spec

    @property
    def enterprise_policy(self) -> EnterpriseAgentPolicy:
        return self._enterprise_policy

    def evaluate(
        self,
        tool_name: str,
        arguments: Mapping[str, Any] | None,
    ) -> PermissionDecision:
        """Decide a runtime tool call. First match wins."""
        args = dict(arguments) if isinstance(arguments, Mapping) else {}
        if tool_name in self._spec.custom_tool_names:
            return _decision(
                "allow",
                "custom",
                tool_name,
                "custom tool executed by caller",
            )
        denied = enterprise_denied_subject(tool_name, args, self._enterprise_policy)
        if denied:
            return _decision(
                "deny",
                "enterprise",
                denied,
                f'denied by enterprise policy "{denied}"',
            )
        if tool_name in self._platform_tools:
            return _decision("allow", "platform", tool_name, "platform tool injected by host")
        entry = self._spec.tool(tool_name)
        if entry is None:
            return _decision(
                "deny",
                "unlisted",
                tool_name,
                f'tool "{tool_name}" is not enabled for this agent',
            )
        asked = enterprise_ask_subject(tool_name, args, self._enterprise_policy)
        if asked:
            return _decision(
                "ask",
                "enterprise",
                asked,
                f'enterprise policy requires confirmation for "{asked}"',
            )
        if entry.policy == "always_ask":
            return _decision(
                "ask",
                "manifest",
                tool_name,
                "manifest policy always_ask",
            )
        return _decision(
            "allow",
            "manifest",
            tool_name,
            "manifest policy always_allow",
        )

    def evaluate_mcp(
        self,
        server: str,
        tool_name: str,
        arguments: Mapping[str, Any] | None,
    ) -> PermissionDecision:
        """Decide an MCP tool. W1 does not wire this into the runtime."""
        del arguments
        probe_args = {"tool_name": tool_name}
        denied = enterprise_denied_subject(
            "mcp_call",
            probe_args,
            self._enterprise_policy,
        )
        if denied:
            return _decision(
                "deny",
                "enterprise",
                denied,
                f'denied by enterprise policy "{denied}"',
            )
        toolset = self._spec.mcp_toolset(server)
        if toolset is None:
            return _decision(
                "deny",
                "unlisted",
                tool_name,
                f'mcp server "{server}" is not enabled for this agent',
            )
        policy = toolset.policy_for(tool_name)
        if policy is None:
            return _decision(
                "deny",
                "unlisted",
                tool_name,
                f'mcp tool "{server}/{tool_name}" is disabled for this agent',
            )
        asked = enterprise_ask_subject(
            "mcp_call",
            probe_args,
            self._enterprise_policy,
        )
        if asked:
            return _decision(
                "ask",
                "enterprise",
                asked,
                f'enterprise policy requires confirmation for "{asked}"',
            )
        if policy == "always_ask":
            return _decision(
                "ask",
                "manifest",
                tool_name,
                "manifest policy always_ask",
            )
        return _decision(
            "allow",
            "manifest",
            tool_name,
            "manifest policy always_allow",
        )


class ToolAuthorization:
    """Single-slot grant shared by the permission hook and confirm gate."""

    def __init__(self) -> None:
        self.current: str | None = None

    def grant(self, tool_name: str) -> None:
        self.current = tool_name

    def revoke(self) -> None:
        self.current = None

    def allows(self, tool_name: str | None) -> bool:
        """True when a grant exists and the name is empty or matches it."""
        if self.current is None:
            return False
        if not tool_name:
            return True
        return tool_name == self.current


class ManagedConfirmGate(ConfirmGate):
    """Personal-mode confirm replacement. Never emits confirm_required."""

    def __init__(self, authorization: ToolAuthorization) -> None:
        self._authorization = authorization
        self.last_request: dict[str, Any] | None = None

    async def request_confirm(
        self,
        question: str,
        context: dict[str, Any] | None = None,
    ) -> bool:
        payload = dict(context or {})
        tool = str(payload.get("tool") or "").strip() or None
        approved = self._authorization.allows(tool)
        if approved:
            decision = "managed_authorized"
        else:
            decision = "managed_unauthorized"
        self.last_request = {
            "id": str(payload.get("request_id") or new_ulid()),
            "question": question,
            "context": payload,
            "decision": decision,
        }
        return approved

    def should_emit_prompt(self, context: dict[str, Any] | None = None) -> bool:
        del context
        return False

    def is_service_mode(self) -> bool:
        return True

    def resolve(self, request_id: str, approved: bool) -> bool:
        del request_id, approved
        return False


class ManagedPermissionHook(AgentHook):
    """before_tool_call hook: announce, maybe wait, then grant or block."""

    def __init__(
        self,
        *,
        engine: PermissionEngine,
        broker: ActionBroker,
        authorization: ToolAuthorization,
        mcp_router_getter: Callable[[], Any] | None = None,
    ) -> None:
        self._engine = engine
        self._broker = broker
        self._authorization = authorization
        self._mcp_router_getter = mcp_router_getter

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: Any,
    ) -> HookOutcome | None:
        del session
        self._authorization.revoke()
        args = arguments if isinstance(arguments, dict) else {}
        decision = self._engine.evaluate(tool_name, args)
        if decision.source == "custom":
            return None
        router = self._mcp_router_getter() if self._mcp_router_getter is not None else None
        binding = router.resolve(tool_name) if router is not None else None
        if binding is not None:
            decision = self._engine.evaluate_mcp(binding.server, binding.tool, args)
            event_id = await self._broker.announce_tool_use(
                kind="mcp",
                name=binding.tool,
                input=args,
                evaluated_policy=decision.evaluated_policy,
                mcp_server=binding.server,
                ledger_name=tool_name,
            )
            return await self._apply_decision(decision, event_id, tool_name)
        event_id = await self._broker.announce_tool_use(
            kind="builtin",
            name=tool_name,
            input=args,
            evaluated_policy=decision.evaluated_policy,
        )
        return await self._apply_decision(decision, event_id, tool_name)

    async def _apply_decision(
        self,
        decision: PermissionDecision,
        event_id: str,
        tool_name: str,
    ) -> HookOutcome | None:
        if decision.decision == "deny":
            return HookOutcome(blocked=True, reason=f"ERROR: {decision.reason}")
        if decision.decision == "ask":
            resolution = await self._broker.request_action(event_id, "tool_confirmation")
            blocked = _ask_block_reason(resolution)
            if blocked is not None:
                return HookOutcome(blocked=True, reason=blocked)
        self._authorization.grant(tool_name)
        return None


def _ask_block_reason(resolution: Any) -> str | None:
    if resolution is None:
        return "CANCELLED: interrupted while waiting for confirmation"
    if isinstance(resolution, UserToolConfirmation) and resolution.result == "allow":
        return None
    note = getattr(resolution, "deny_message", None)
    reason = "CANCELLED: tool use denied by user"
    if note:
        return f"{reason}: {note}"
    return reason


__all__ = [
    "Decision",
    "DecisionSource",
    "PermissionDecision",
    "PermissionEngine",
    "ToolAuthorization",
    "ManagedConfirmGate",
    "ManagedPermissionHook",
]
