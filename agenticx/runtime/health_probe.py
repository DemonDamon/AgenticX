#!/usr/bin/env python3
"""Background LLM health probe for active providers.

Periodically sends lightweight pings to configured providers and
maintains a health status dict for failover decision-making.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

_log = logging.getLogger(__name__)


def _resolve_probe_interval() -> float:
    """Probe interval in seconds (0 to disable)."""
    raw = os.environ.get("AGX_HEALTH_PROBE_INTERVAL_SEC", "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return 60.0


class ProviderHealthStatus:
    """Health snapshot for a single provider."""

    __slots__ = ("provider", "model", "healthy", "latency_ms", "last_check", "error")

    def __init__(self, provider: str, model: str) -> None:
        self.provider = provider
        self.model = model
        self.healthy: bool = True
        self.latency_ms: float = 0.0
        self.last_check: float = 0.0
        self.error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "healthy": self.healthy,
            "latency_ms": round(self.latency_ms, 1),
            "last_check": self.last_check,
            "error": self.error,
        }


class HealthProbeManager:
    """Background health prober for LLM providers.

    Runs as a background asyncio task, periodically pinging each
    registered provider with a minimal request to verify availability.
    """

    def __init__(self) -> None:
        self._providers: Dict[str, ProviderHealthStatus] = {}
        self._task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()
        self._interval = _resolve_probe_interval()

    def register_provider(self, provider: str, model: str) -> None:
        key = f"{provider}/{model}"
        if key not in self._providers:
            self._providers[key] = ProviderHealthStatus(provider, model)

    @property
    def statuses(self) -> Dict[str, Dict[str, Any]]:
        return {k: v.to_dict() for k, v in self._providers.items()}

    def is_healthy(self, provider: str, model: str) -> bool:
        key = f"{provider}/{model}"
        status = self._providers.get(key)
        if status is None:
            return True
        return status.healthy

    def start(self) -> None:
        """Start the background probe loop."""
        if self._interval <= 0 or self._task is not None:
            return
        try:
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._probe_loop())
        except RuntimeError:
            pass

    def stop(self) -> None:
        """Signal the probe loop to stop."""
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def _probe_loop(self) -> None:
        _log.info("Health probe loop started (interval=%.0fs)", self._interval)
        while not self._stop.is_set():
            for key, status in list(self._providers.items()):
                if self._stop.is_set():
                    break
                await self._ping_provider(status)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
                break
            except asyncio.TimeoutError:
                continue
        _log.info("Health probe loop stopped")

    async def _ping_provider(self, status: ProviderHealthStatus) -> None:
        """Send a minimal invoke to check provider health."""
        try:
            from agenticx.llms.provider_resolver import ProviderResolver
            llm = ProviderResolver.resolve(
                provider_name=status.provider,
                model=status.model,
            )
        except Exception as exc:
            status.healthy = False
            status.error = str(exc)[:200]
            status.last_check = time.time()
            return

        start = time.time()
        try:
            await asyncio.to_thread(
                llm.invoke,
                [{"role": "user", "content": "ping"}],
                max_tokens=1,
                temperature=0,
            )
            status.healthy = True
            status.error = ""
            status.latency_ms = (time.time() - start) * 1000
        except Exception as exc:
            status.healthy = False
            status.error = str(exc)[:200]
            status.latency_ms = (time.time() - start) * 1000
            _log.debug(
                "Health probe failed for %s/%s: %s",
                status.provider, status.model, exc,
            )
        status.last_check = time.time()

    async def probe_once(self) -> Dict[str, Dict[str, Any]]:
        """Run a single round of probing (useful for on-demand checks)."""
        for status in self._providers.values():
            await self._ping_provider(status)
        return self.statuses
