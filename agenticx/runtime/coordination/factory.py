#!/usr/bin/env python3
"""Factory and process-level singleton for the coordination bus (Plan C).

Resolution order:

- env ``AGX_COORDINATION_BACKEND`` > ``runtime.coordination_backend`` in
  config > default: ``redis`` when HA mode is active (``AGX_HA_MODE=redis``
  or the storage backend resolves to redis), else ``inprocess``.
- redis URL: env ``AGX_REDIS_URL`` > ``runtime.redis_url`` >
  ``AGENTICX_REDIS_URL``/``REDIS_URL`` (shared RedisBackend semantics).

Startup health gating (``ping`` failure → fall back to in-process) happens in
the server lifespan, which is async; the factory itself stays synchronous.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import threading

from agenticx.runtime.coordination.bus import CoordinationBus
from agenticx.runtime.coordination.in_process import InProcessBus

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_singleton: CoordinationBus | None = None

_VALID_KINDS = ("inprocess", "redis")


def _config_value(key: str) -> object:
    try:
        from agenticx.cli.config_manager import ConfigManager

        return ConfigManager.get_value(key)
    except Exception:
        logger.debug("config read failed for %s (ignored)", key, exc_info=True)
        return None


def _resolve_bus_kind() -> str:
    env = os.environ.get("AGX_COORDINATION_BACKEND", "").strip().lower()
    if env in _VALID_KINDS:
        return env
    if env:
        logger.warning("unknown AGX_COORDINATION_BACKEND=%r (ignored)", env)
    cfg = _config_value("runtime.coordination_backend")
    if isinstance(cfg, str) and cfg.strip().lower() in _VALID_KINDS:
        return cfg.strip().lower()
    # Default follows HA/storage mode so one switch lights up the full stack.
    if os.environ.get("AGX_HA_MODE", "").strip().lower() == "redis":
        return "redis"
    if os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower() == "redis":
        return "redis"
    if str(_config_value("runtime.storage_backend") or "").strip().lower() == "redis":
        return "redis"
    return "inprocess"


def _resolve_redis_url() -> str | None:
    env = os.environ.get("AGX_REDIS_URL", "").strip()
    if env:
        return env
    cfg = _config_value("runtime.redis_url")
    if isinstance(cfg, str) and cfg.strip():
        return cfg.strip()
    return None


def _build_bus() -> CoordinationBus:
    if _resolve_bus_kind() == "redis":
        from agenticx.runtime.coordination.redis_bus import RedisBus

        return RedisBus(url=_resolve_redis_url())
    return InProcessBus()


def get_coordination_bus() -> CoordinationBus:
    """Return the process-level coordination bus singleton (lazy)."""
    global _singleton
    if _singleton is None:
        with _lock:
            if _singleton is None:
                _singleton = _build_bus()
    return _singleton


def _close_bus_quietly(bus: CoordinationBus) -> None:
    close = getattr(bus, "close", None)
    if not callable(close):
        return
    try:
        result = close()
    except Exception:
        logger.debug("bus close failed (ignored)", exc_info=True)
        return
    if not hasattr(result, "__await__"):
        return
    import asyncio

    async def _await_close() -> None:
        try:
            await result
        except Exception:
            logger.debug("bus close failed (ignored)", exc_info=True)

    try:
        asyncio.get_running_loop().create_task(_await_close())
    except RuntimeError:
        try:
            asyncio.run(_await_close())
        except Exception:
            pass


def set_coordination_bus(bus: CoordinationBus) -> None:
    """Replace the singleton (startup health fallback / tests)."""
    global _singleton
    with _lock:
        old, _singleton = _singleton, bus
    if old is not None and old is not bus:
        _close_bus_quietly(old)


def reset_coordination_bus_for_testing() -> None:
    """Drop the singleton so tests can re-resolve with patched env/config."""
    global _singleton
    with _lock:
        bus, _singleton = _singleton, None
    if bus is not None:
        _close_bus_quietly(bus)
