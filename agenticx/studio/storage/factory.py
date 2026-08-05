#!/usr/bin/env python3
"""Factory and process-level singleton for session storage backends.

Resolution order:

- backend kind: env ``AGX_STORAGE_BACKEND`` > ``runtime.storage_backend``
  in ``~/.agenticx/config.yaml`` > ``local`` (default, pre-HA behavior).
- redis URL: env ``AGX_REDIS_URL`` > ``runtime.redis_url`` in config >
  ``AGENTICX_REDIS_URL``/``REDIS_URL`` (handled by the shared RedisBackend).

``ConfigManager.get_value`` already resolves arbitrary dotted keys from the
merged YAML, so no config-manager changes are required for the two new keys.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from agenticx.studio.storage.backend import SessionStorageBackend, SyncStorageFacade
from agenticx.studio.storage.local_file import LocalFileBackend

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_singleton: SessionStorageBackend | None = None

_VALID_KINDS = ("local", "redis")


def _default_sessions_root() -> Path:
    return Path.home() / ".agenticx" / "sessions"


def _default_config_dir() -> Path:
    return Path.home() / ".agenticx"


def _config_value(key: str) -> object:
    try:
        from agenticx.cli.config_manager import ConfigManager

        return ConfigManager.get_value(key)
    except Exception:
        logger.debug("config read failed for %s (ignored)", key, exc_info=True)
        return None


def _resolve_backend_kind() -> str:
    env = os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower()
    if env in _VALID_KINDS:
        return env
    if env:
        logger.warning("unknown AGX_STORAGE_BACKEND=%r (ignored)", env)
    cfg = _config_value("runtime.storage_backend")
    if isinstance(cfg, str) and cfg.strip().lower() in _VALID_KINDS:
        return cfg.strip().lower()
    return "local"


def _resolve_redis_url() -> str | None:
    env = os.environ.get("AGX_REDIS_URL", "").strip()
    if env:
        return env
    cfg = _config_value("runtime.redis_url")
    if isinstance(cfg, str) and cfg.strip():
        return cfg.strip()
    return None


def _build_backend() -> SessionStorageBackend:
    kind = _resolve_backend_kind()
    if kind == "redis":
        from agenticx.studio.storage.redis_backend import RedisSessionStorage

        return RedisSessionStorage(url=_resolve_redis_url())
    return LocalFileBackend(
        sessions_root=_default_sessions_root(),
        config_dir=_default_config_dir(),
    )


def get_storage_backend() -> SessionStorageBackend:
    """Return the process-level storage backend singleton (lazy)."""
    global _singleton
    if _singleton is None:
        with _lock:
            if _singleton is None:
                _singleton = _build_backend()
    return _singleton


def get_sync_storage() -> SyncStorageFacade:
    """Return a synchronous facade over the storage backend singleton."""
    return SyncStorageFacade(get_storage_backend())


def reset_storage_backend_for_testing() -> None:
    """Drop the singleton so tests can re-resolve with patched env/config."""
    global _singleton
    with _lock:
        backend, _singleton = _singleton, None
    if backend is not None:
        close = getattr(backend, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                logger.debug("storage backend close failed (ignored)", exc_info=True)
