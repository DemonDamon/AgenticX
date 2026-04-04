#!/usr/bin/env python3
"""Bridge runtime hooks to the legacy global hook bus."""

from __future__ import annotations

from typing import Any, Dict

from agenticx.hooks import HookEvent, trigger_hook_event
from agenticx.runtime.hooks import AgentHook, HookOutcome


class LegacyEventBridgeHook(AgentHook):
    """Emit runtime lifecycle/tool events to the global hook registry."""

    @staticmethod
    def _session_key(session: Any) -> str:
        sid = getattr(session, "_session_id", None)
        return str(sid or "")

    async def on_agent_start(self, session: Any, agent_id: str, user_input: str) -> None:
        await trigger_hook_event(
            HookEvent(
                type="agent",
                action="start",
                agent_id=agent_id,
                session_key=self._session_key(session),
                context={"user_input": user_input},
            )
        )

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session: Any,
    ) -> HookOutcome | None:
        context: Dict[str, Any] = {
            "tool_name": tool_name,
            "tool_input": dict(arguments or {}),
        }
        if tool_name == "bash_exec":
            context["command"] = str(arguments.get("command", "") if isinstance(arguments, dict) else "")

        allowed = await trigger_hook_event(
            HookEvent(
                type="tool",
                action="before_call",
                agent_id="meta",
                session_key=self._session_key(session),
                context=context,
            )
        )
        if not allowed:
            return HookOutcome(blocked=True, reason="工具调用被 Hook 策略阻止。")
        return None

    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None:
        await trigger_hook_event(
            HookEvent(
                type="tool",
                action="after_call",
                agent_id="meta",
                session_key=self._session_key(session),
                context={
                    "tool_name": tool_name,
                    "tool_result": result,
                },
            )
        )
        return None

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        await trigger_hook_event(
            HookEvent(
                type="agent",
                action="stop",
                agent_id="meta",
                session_key=self._session_key(session),
                context={"final_text": final_text},
            )
        )
