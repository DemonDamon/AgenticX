#!/usr/bin/env python3
"""Tool Fallback Chain — multi-level tool resolution with graceful degradation.

Inspired by Anthropic Claude Computer Use (2026.03):
  Level 0: API Connector (MCP / direct integration)
  Level 1: Browser Automation (Playwright)
  Level 2: Computer Use (screenshot + mouse/keyboard)

Author: Damon Li
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class FallbackLevel(IntEnum):
    """Priority levels for tool resolution (lower = higher priority)."""
    API_CONNECTOR = 0
    BROWSER = 1
    COMPUTER_USE = 2


class ToolResolver(ABC):
    """Abstract resolver for a specific fallback level."""

    @abstractmethod
    async def can_handle(self, task_intent: str) -> bool:
        """Check if this resolver can handle the given task intent."""

    @abstractmethod
    async def resolve(self, task_intent: str, **kwargs) -> str:
        """Execute the task and return result string."""


@dataclass
class FallbackResult:
    """Result of a fallback chain execution."""
    level: FallbackLevel
    output: str
    attempted_levels: List[FallbackLevel] = field(default_factory=list)
    errors: Dict[FallbackLevel, str] = field(default_factory=dict)


class ToolFallbackChain:
    """Multi-level tool resolution chain with graceful degradation.

    Resolvers are tried in priority order (API -> Browser -> Computer Use).
    The first resolver that can handle the task intent is used. If it fails,
    the chain falls through to the next level.
    """

    def __init__(self) -> None:
        self._resolvers: Dict[FallbackLevel, ToolResolver] = {}

    def register(self, level: FallbackLevel, resolver: ToolResolver) -> None:
        """Register a resolver at the given fallback level."""
        self._resolvers[level] = resolver

    async def execute(
        self,
        task_intent: str,
        *,
        max_level: Optional[FallbackLevel] = None,
        **kwargs,
    ) -> FallbackResult:
        """Execute task_intent, falling through levels as needed.

        Args:
            task_intent: Description or identifier of the task to perform.
            max_level: Maximum fallback level to attempt (inclusive).

        Returns:
            FallbackResult with the output from the first successful resolver.

        Raises:
            RuntimeError: If no resolver can handle the task.
        """
        if not self._resolvers:
            raise RuntimeError("No resolver registered in fallback chain")

        attempted: List[FallbackLevel] = []
        errors: Dict[FallbackLevel, str] = {}

        for level in sorted(self._resolvers.keys()):
            if max_level is not None and level > max_level:
                break

            resolver = self._resolvers[level]
            attempted.append(level)

            try:
                if not await resolver.can_handle(task_intent):
                    logger.debug(
                        "Level %s cannot handle '%s', skipping",
                        level.name, task_intent,
                    )
                    continue

                output = await resolver.resolve(task_intent, **kwargs)
                logger.info(
                    "Task '%s' resolved at level %s",
                    task_intent, level.name,
                )
                return FallbackResult(
                    level=level,
                    output=output,
                    attempted_levels=attempted,
                    errors=errors,
                )
            except Exception as exc:
                logger.warning(
                    "Level %s failed for '%s': %s",
                    level.name, task_intent, exc,
                )
                errors[level] = str(exc)

        raise RuntimeError(
            f"No resolver could handle '{task_intent}'. "
            f"Attempted: {[l.name for l in attempted]}, "
            f"Errors: {errors}"
        )
