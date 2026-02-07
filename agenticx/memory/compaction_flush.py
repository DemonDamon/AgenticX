"""
AgenticX Memory Flush Before Compaction

Inspired by OpenClaw's ``agents.defaults.compaction.memoryFlush`` mechanism:
before the context window is compacted / compressed, a silent Agent turn is
triggered to persist critical information to long-term memory, preventing
important context from being lost during compaction.

Source: OpenClaw DeepWiki — agents.defaults.compaction.memoryFlush (Apache-2.0)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class CompactionFlushConfig:
    """Configuration for the pre-compaction memory flush.

    Attributes:
        enabled: Master switch.  When ``False`` the flush step is skipped.
        soft_threshold_tokens: How many tokens *before* the hard
            ``max_context_tokens`` limit the flush should fire.
            e.g. if max_context_tokens = 8000 and soft_threshold_tokens = 1000,
            the flush fires at 7000 tokens.
        reserve_tokens_floor: Minimum number of tokens that must remain
            available for new content after the flush.
        flush_prompt: The prompt injected into a silent Agent turn to instruct
            it to persist important information.
    """

    enabled: bool = True
    soft_threshold_tokens: int = 1000
    reserve_tokens_floor: int = 2000
    flush_prompt: str = (
        "Your context window is nearly full. "
        "Write any important information to memory files now. "
        "Focus on: key decisions, action items, and critical context."
    )


# ---------------------------------------------------------------------------
# Protocol / interface
# ---------------------------------------------------------------------------

@runtime_checkable
class MemoryFlushHandler(Protocol):
    """Protocol that any flush handler must satisfy.

    Implementations receive the current token metrics and a config object and
    decide (a) whether to flush and (b) how to execute the flush.
    """

    async def should_flush(
        self,
        current_tokens: int,
        max_tokens: int,
        config: CompactionFlushConfig,
    ) -> bool:
        """Return ``True`` if a flush should be triggered."""
        ...

    async def execute_flush(
        self,
        config: CompactionFlushConfig,
    ) -> Optional[str]:
        """Execute the flush and return any result / confirmation string.

        Implementations should be *silent* — i.e. should not produce visible
        output to the end-user.  The returned string is purely informational
        (for logging / observability).
        """
        ...


# ---------------------------------------------------------------------------
# Default implementation
# ---------------------------------------------------------------------------

class DefaultMemoryFlushHandler:
    """Default handler that checks a soft-threshold and returns the flush prompt.

    This handler does **not** actually persist anything — it merely decides
    whether the threshold has been reached and, if so, returns the configured
    prompt text.  The calling code (e.g. ``ContextCompiler``) is responsible
    for routing this prompt to the agent as a silent turn.

    Parameters
    ----------
    on_flush : callable | None
        Optional async callback ``(prompt: str) -> str | None`` that is
        invoked when a flush is executed.  Useful for integration tests or
        custom persistence logic.
    """

    def __init__(
        self,
        on_flush: Optional[Callable[[str], Coroutine[Any, Any, Optional[str]]]] = None,
    ) -> None:
        self._on_flush = on_flush
        self._flush_count: int = 0

    async def should_flush(
        self,
        current_tokens: int,
        max_tokens: int,
        config: CompactionFlushConfig,
    ) -> bool:
        if not config.enabled:
            return False
        threshold = max_tokens - config.soft_threshold_tokens
        should = current_tokens >= threshold
        if should:
            logger.info(
                "MemoryFlush: threshold reached (%d >= %d). "
                "Will flush before compaction.",
                current_tokens,
                threshold,
            )
        return should

    async def execute_flush(
        self,
        config: CompactionFlushConfig,
    ) -> Optional[str]:
        self._flush_count += 1
        logger.info("MemoryFlush: executing flush #%d", self._flush_count)

        if self._on_flush is not None:
            return await self._on_flush(config.flush_prompt)
        return config.flush_prompt

    # -- introspection -------------------------------------------------------

    @property
    def flush_count(self) -> int:
        """How many times ``execute_flush`` has been called."""
        return self._flush_count
