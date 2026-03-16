#!/usr/bin/env python3
"""LLM failover provider with cooldown management.

Wraps a primary and fallback LLM provider. On consecutive failures from
the primary exceeding a configurable threshold, the provider enters a
cooldown period and routes all calls to the fallback until the cooldown
expires.

Internalized from IronClaw LLM resilience patterns.

Author: Damon Li
"""

import logging
import time
from typing import Any, AsyncGenerator, Dict, Generator, List, Union

from pydantic import PrivateAttr

from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse

logger = logging.getLogger(__name__)


class FailoverProvider(BaseLLMProvider):
    """LLM provider with primary/fallback failover and cooldown logic.

    Routes requests to the primary provider. On failure, records the
    error and delegates to the fallback provider. After consecutive
    failures reach ``failure_threshold``, the primary is bypassed for
    ``cooldown_duration`` seconds before being retried again.
    """

    # Pydantic fields for constructor params
    failure_threshold: int = 3
    cooldown_duration: float = 60.0

    # Private mutable state — not part of the Pydantic schema
    _primary: BaseLLMProvider = PrivateAttr()
    _fallback: BaseLLMProvider = PrivateAttr()
    _consecutive_failures: int = PrivateAttr(default=0)
    _cooldown_until: float = PrivateAttr(default=0.0)

    def __init__(
        self,
        primary: BaseLLMProvider,
        fallback: BaseLLMProvider,
        failure_threshold: int = 3,
        cooldown_duration: float = 60.0,
        **kwargs: Any,
    ) -> None:
        # Use a sentinel model name; the actual routing model is determined at runtime.
        super().__init__(
            model="failover",
            failure_threshold=failure_threshold,
            cooldown_duration=cooldown_duration,
            **kwargs,
        )
        self._primary = primary
        self._fallback = fallback

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _in_cooldown(self) -> bool:
        """Return True if the primary is currently in cooldown."""
        return time.monotonic() < self._cooldown_until

    def _record_failure(self) -> None:
        """Increment failure counter and enter cooldown when threshold reached."""
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.failure_threshold:
            self._cooldown_until = time.monotonic() + self.cooldown_duration
            logger.warning(
                "FailoverProvider: primary hit failure_threshold=%d, "
                "entering cooldown for %.1fs",
                self.failure_threshold,
                self.cooldown_duration,
            )

    def _record_success(self) -> None:
        """Reset failure state after a successful primary call."""
        self._consecutive_failures = 0
        self._cooldown_until = 0.0

    # ------------------------------------------------------------------
    # BaseLLMProvider interface
    # ------------------------------------------------------------------

    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """Invoke the primary provider; fall back on error or cooldown."""
        if not self._in_cooldown():
            try:
                response = self._primary.invoke(prompt, **kwargs)
                self._record_success()
                return response
            except Exception as exc:
                logger.warning("FailoverProvider: primary failed — %s", exc)
                self._record_failure()

        logger.info("FailoverProvider: routing to fallback provider")
        return self._fallback.invoke(prompt, **kwargs)

    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        """Async version: invoke the primary provider; fall back on error or cooldown."""
        if not self._in_cooldown():
            try:
                response = await self._primary.ainvoke(prompt, **kwargs)
                self._record_success()
                return response
            except Exception as exc:
                logger.warning("FailoverProvider: primary async failed — %s", exc)
                self._record_failure()

        logger.info("FailoverProvider: routing to fallback provider (async)")
        return await self._fallback.ainvoke(prompt, **kwargs)

    def stream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> Generator[Union[str, Dict], None, None]:
        """Stream from the primary provider; fall back on error or cooldown."""
        if not self._in_cooldown():
            try:
                yield from self._primary.stream(prompt, **kwargs)
                self._record_success()
                return
            except Exception as exc:
                logger.warning("FailoverProvider: primary stream failed — %s", exc)
                self._record_failure()

        logger.info("FailoverProvider: streaming from fallback provider")
        yield from self._fallback.stream(prompt, **kwargs)

    async def astream(
        self, prompt: Union[str, List[Dict]], **kwargs: Any
    ) -> AsyncGenerator[Union[str, Dict], None]:
        """Async stream from the primary provider; fall back on error or cooldown."""
        if not self._in_cooldown():
            try:
                async for chunk in self._primary.astream(prompt, **kwargs):
                    yield chunk
                self._record_success()
                return
            except Exception as exc:
                logger.warning("FailoverProvider: primary astream failed — %s", exc)
                self._record_failure()

        logger.info("FailoverProvider: async streaming from fallback provider")
        async for chunk in self._fallback.astream(prompt, **kwargs):
            yield chunk

    def stream_with_tools(
        self, prompt: Union[str, List[Dict]], tools: List[Dict] | None = None, **kwargs: Any
    ) -> Generator[Dict[str, Any], None, None]:
        """Stream tool-call aware chunks from primary, fallback on error/cooldown."""
        if not self._in_cooldown():
            try:
                yield from self._primary.stream_with_tools(prompt, tools=tools, **kwargs)
                self._record_success()
                return
            except Exception as exc:
                logger.warning("FailoverProvider: primary stream_with_tools failed — %s", exc)
                self._record_failure()

        logger.info("FailoverProvider: stream_with_tools from fallback provider")
        yield from self._fallback.stream_with_tools(prompt, tools=tools, **kwargs)
