#!/usr/bin/env python3
"""Leader election for cluster-wide singletons (e.g. the automation scheduler).

Built on the coordination bus session-lock primitive (Plan C): the leader
holds a well-known lock with lease TTL + heartbeat; when the leader dies,
its lease expires and another replica's campaign loop acquires it. With the
in-process bus the lock is always granted, so ``am_i_leader`` is True — the
single-replica behavior is unchanged.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid

from agenticx.runtime.coordination.bus import CoordinationBus

logger = logging.getLogger(__name__)


class LeaderGate:
    """Campaigns for a named leader lock and reports leadership."""

    def __init__(
        self,
        bus: CoordinationBus,
        *,
        name: str = "automation",
        instance_id: str | None = None,
        ttl_ms: int = 30000,
        campaign_interval: float = 5.0,
        jitter_max: float = 3.0,
    ) -> None:
        self._bus = bus
        self._name = name
        self._instance_id = instance_id or uuid.uuid4().hex[:8]
        self._ttl_ms = ttl_ms
        self._campaign_interval = campaign_interval
        self._jitter_max = jitter_max
        self._lock = None
        self._campaign_task: asyncio.Task | None = None

    @property
    def instance_id(self) -> str:
        return self._instance_id

    async def start(self) -> None:
        """Start the campaign loop (initial jitter avoids same-beat stampedes)."""
        if self._campaign_task is not None:
            return
        self._campaign_task = asyncio.create_task(self._campaign_loop())

    async def stop(self) -> None:
        if self._campaign_task is not None:
            self._campaign_task.cancel()
            try:
                await self._campaign_task
            except asyncio.CancelledError:
                pass
            self._campaign_task = None
        await self._release()

    async def am_i_leader(self) -> bool:
        return self._lock is not None

    async def _campaign_loop(self) -> None:
        if self._jitter_max > 0:
            await asyncio.sleep(random.uniform(0, self._jitter_max))
        while True:
            if self._lock is None:
                try:
                    lock = await self._bus.acquire_session_lock(
                        f"__leader_{self._name}__",
                        owner=self._instance_id,
                        ttl_ms=self._ttl_ms,
                    )
                except Exception:
                    logger.debug("leader campaign failed name=%s", self._name, exc_info=True)
                    lock = None
                if lock is not None:
                    try:
                        lock.on_lost = self._on_lock_lost  # type: ignore[attr-defined]
                    except Exception:
                        pass
                    self._lock = lock
                    logger.info("leader acquired name=%s instance=%s", self._name, self._instance_id)
            await asyncio.sleep(self._campaign_interval)

    def _on_lock_lost(self) -> None:
        logger.warning("leader lock lost name=%s instance=%s", self._name, self._instance_id)
        self._lock = None

    async def _release(self) -> None:
        lock, self._lock = self._lock, None
        if lock is not None:
            try:
                await lock.release()
            except Exception:
                logger.debug("leader lock release failed", exc_info=True)
