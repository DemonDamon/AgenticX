#!/usr/bin/env python3
"""AgentHook adapter for GuardrailProvider (DeerFlow guardrails semantics).

Author: Damon Li
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Optional

from agenticx.runtime.hooks import AgentHook, HookOutcome
from agenticx.tools.guardrails.provider import (
    GuardrailDecision,
    GuardrailProvider,
    GuardrailReason,
    GuardrailRequest,
)

logger = logging.getLogger(__name__)


class ToolGuardrailHook(AgentHook):
    """Runs GuardrailProvider before each tool call; maps deny to HookOutcome."""

    def __init__(
        self,
        provider: GuardrailProvider,
        *,
        fail_closed: bool = True,
        agent_id: str | None = None,
    ) -> None:
        self._provider = provider
        self._fail_closed = fail_closed
        self._default_agent_id = agent_id

    def _build_request(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: Any,
    ) -> GuardrailRequest:
        session_id = getattr(session, "session_id", None) if session is not None else None
        if session_id is not None:
            session_id = str(session_id)
        agent_id = self._default_agent_id
        if agent_id is None and session is not None:
            agent_id = getattr(session, "agent_id", None)
            if agent_id is not None:
                agent_id = str(agent_id)
        return GuardrailRequest(
            tool_name=tool_name,
            tool_input=dict(arguments or {}),
            agent_id=agent_id,
            session_id=session_id,
            timestamp=datetime.now(UTC).isoformat(),
        )

    def _denied_outcome(self, decision: GuardrailDecision, tool_name: str) -> HookOutcome:
        if decision.reasons:
            r0 = decision.reasons[0]
            code = r0.code
            msg = r0.message or "blocked by guardrail"
        else:
            code = "agx.denied"
            msg = "blocked by guardrail"
        return HookOutcome(
            blocked=True,
            reason=f"Guardrail denied ({code}): tool '{tool_name}'. {msg}",
        )

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: Any,
    ) -> Optional[HookOutcome]:
        request = self._build_request(tool_name, arguments, session)
        try:
            decision = await self._provider.aevaluate(request)
        except Exception:
            logger.exception("Guardrail provider error for tool=%s", tool_name)
            if self._fail_closed:
                return HookOutcome(
                    blocked=True,
                    reason="guardrail provider error (fail-closed)",
                )
            return None

        if not decision.allow:
            logger.warning(
                "Guardrail denied: tool=%s code=%s",
                tool_name,
                decision.reasons[0].code if decision.reasons else "unknown",
            )
            return self._denied_outcome(decision, tool_name)
        return None
