#!/usr/bin/env python3
"""LLM factory protocol for managed agent sessions.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from agenticx.llms.provider_resolver import ProviderResolver


@dataclass(frozen=True)
class LLMCallContext:
    tenant_id: str
    session_id: str
    agent_id: str
    agent_version: int
    user_id: str | None = None
    thread_id: str | None = None
    thread_role: Literal["self", "agent", "advisor"] | None = None


@runtime_checkable
class LLMFactory(Protocol):
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        """Return an LLM provider object accepted by AgentRuntime (has .invoke / .stream)."""


class LocalConfigLLMFactory:
    """W1 default: resolve from the local agx provider config (~/.agenticx/config.yaml)."""

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        del context
        return ProviderResolver.resolve(provider_name=provider, model=model)


__all__ = [
    "LLMCallContext",
    "LLMFactory",
    "LocalConfigLLMFactory",
]
