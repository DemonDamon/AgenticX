#!/usr/bin/env python3
"""Built-in guardrail providers (zero external dependencies).

Author: Damon Li
"""

from __future__ import annotations

from agenticx.tools.guardrails.provider import (
    GuardrailDecision,
    GuardrailReason,
    GuardrailRequest,
)


class AllowlistProvider:
    """Allowlist or denylist by tool name only."""

    name = "allowlist"

    def __init__(
        self,
        *,
        allowed_tools: list[str] | None = None,
        denied_tools: list[str] | None = None,
    ) -> None:
        self._allowed = set(allowed_tools) if allowed_tools else None
        self._denied = set(denied_tools) if denied_tools else set()

    def evaluate(self, request: GuardrailRequest) -> GuardrailDecision:
        if self._allowed is not None and request.tool_name not in self._allowed:
            return GuardrailDecision(
                allow=False,
                reasons=[
                    GuardrailReason(
                        code="agx.tool_not_in_allowlist",
                        message=f"tool '{request.tool_name}' not in allowlist",
                    )
                ],
            )
        if request.tool_name in self._denied:
            return GuardrailDecision(
                allow=False,
                reasons=[
                    GuardrailReason(
                        code="agx.tool_denied",
                        message=f"tool '{request.tool_name}' is denied by policy",
                    )
                ],
            )
        return GuardrailDecision(
            allow=True,
            reasons=[GuardrailReason(code="agx.allowed", message="allowed")],
        )

    async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision:
        return self.evaluate(request)
