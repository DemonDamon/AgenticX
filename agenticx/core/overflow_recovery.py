#!/usr/bin/env python3
"""Progressive context overflow recovery pipeline.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Optional
import logging

from agenticx.core.event import EventLog, ToolResultEvent

logger = logging.getLogger(__name__)


class RecoveryLevel(IntEnum):
    """Ordered recovery levels for context overflow handling."""

    L1_TRUNCATE_TOOL_RESULTS = 1
    L2_EXPLICIT_COMPACTION = 2
    L3_FAST_HEURISTIC = 3


@dataclass
class OverflowRecoveryConfig:
    """Configuration for progressive overflow recovery."""

    l1_enabled: bool = True
    l1_max_result_tokens: int = 4000
    l2_max_attempts: int = 3
    l3_enabled: bool = True


class OverflowRecoveryPipeline:
    """Progressive recovery pipeline for token overflow.

    The recovery order is intentionally cost-aware:
    1) Truncate oversized tool results (cheapest).
    2) Try explicit compaction (bounded retries).
    3) Fall back to fast heuristic compression.
    """

    def __init__(self, compiler: Any, config: Optional[OverflowRecoveryConfig] = None) -> None:
        self._compiler = compiler
        self._config = config or OverflowRecoveryConfig()
        self._l1_attempted = False
        self._l2_attempts = 0

    async def recover(self, event_log: EventLog) -> bool:
        """Attempt recovery and return whether any level succeeded."""
        if self._config.l1_enabled and not self._l1_attempted:
            self._l1_attempted = True
            if self._truncate_oversized_tool_results(
                event_log, self._config.l1_max_result_tokens
            ):
                logger.info("Overflow recovery L1 succeeded: truncated oversized tool results.")
                return True

        while self._l2_attempts < self._config.l2_max_attempts:
            self._l2_attempts += 1
            compacted = await self._compiler.compact(
                event_log, reason=f"overflow_l2_attempt_{self._l2_attempts}"
            )
            if compacted is not None:
                logger.info(
                    "Overflow recovery L2 succeeded on attempt %d.",
                    self._l2_attempts,
                )
                return True

        if self._config.l3_enabled:
            heuristic = self._compiler._fast_compress(  # pylint: disable=protected-access
                event_log, reason="overflow_l3_heuristic"
            )
            if heuristic is not None or not self._compiler._is_emergency(  # pylint: disable=protected-access
                self._compiler._count_event_log_tokens(event_log)  # pylint: disable=protected-access
            ):
                logger.warning("Overflow recovery L3 used fast heuristic compression.")
                return True

        return False

    def reset(self) -> None:
        """Reset per-overflow attempt state."""
        self._l1_attempted = False
        self._l2_attempts = 0

    def _truncate_oversized_tool_results(
        self,
        event_log: EventLog,
        max_result_tokens: int,
    ) -> bool:
        """Truncate oversized tool results in-place.

        Returns True if at least one tool result was truncated.
        """
        changed = False
        for event in event_log.events:
            if not isinstance(event, ToolResultEvent) or not event.success:
                continue
            if event.result is None:
                continue

            result_text = str(event.result)
            token_count = self._compiler.token_counter.count_tokens(result_text)
            if token_count <= max_result_tokens:
                continue

            max_chars = max_result_tokens * 4
            truncated = f"{result_text[:max_chars]}... [truncated by overflow recovery]"
            event.result = truncated
            changed = True

        return changed
