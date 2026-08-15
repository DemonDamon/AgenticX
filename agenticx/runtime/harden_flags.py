#!/usr/bin/env python3
"""Feature flags for long-run runtime hardening.

Resolution order matches ``resume_interrupted_enabled``:
env > ``ConfigManager.get_value(<key>)`` > default.
Parse failures fall back to the default and never raise.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Optional

_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")


def _env_bool(env_name: str) -> Optional[bool]:
    raw = os.environ.get(env_name, "").strip().lower()
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    return None


def _config_bool(key: str) -> Optional[bool]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value(key)
        if isinstance(cfg, bool):
            return cfg
    except Exception:
        pass
    return None


def _config_int(key: str) -> Optional[int]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value(key)
        if isinstance(cfg, bool):
            return None
        if isinstance(cfg, int):
            return cfg
        if isinstance(cfg, str) and cfg.strip():
            return int(cfg.strip())
    except Exception:
        pass
    return None


def _resolve_bool(env_name: str, config_key: str, default: bool) -> bool:
    env = _env_bool(env_name)
    if env is not None:
        return env
    cfg = _config_bool(config_key)
    if cfg is not None:
        return cfg
    return default


def overflow_retry_enabled() -> bool:
    """``AGX_OVERFLOW_RETRY`` / ``runtime.overflow_retry``. Default True."""
    return _resolve_bool("AGX_OVERFLOW_RETRY", "runtime.overflow_retry", True)


def max_overflow_retries() -> int:
    """``AGX_MAX_OVERFLOW_RETRIES`` / ``runtime.max_overflow_retries``. Default 2, clamp 0..5."""
    raw: Optional[int] = None
    env = os.environ.get("AGX_MAX_OVERFLOW_RETRIES", "").strip()
    if env:
        try:
            raw = int(env)
        except Exception:
            raw = None
    if raw is None:
        raw = _config_int("runtime.max_overflow_retries")
    if raw is None:
        raw = 2
    return max(0, min(5, int(raw)))


def interrupted_closers_enabled() -> bool:
    """``AGX_INTERRUPTED_CLOSERS`` / ``runtime.interrupted_closers``. Default True."""
    return _resolve_bool("AGX_INTERRUPTED_CLOSERS", "runtime.interrupted_closers", True)


def persist_fail_closed_enabled() -> bool:
    """``AGX_PERSIST_FAIL_CLOSED`` / ``runtime.persist_fail_closed``. Default False."""
    return _resolve_bool("AGX_PERSIST_FAIL_CLOSED", "runtime.persist_fail_closed", False)


def fresh_round_loop_enabled() -> bool:
    """``AGX_FRESH_ROUND_LOOP`` / ``runtime.fresh_round_loop``. Default False."""
    return _resolve_bool("AGX_FRESH_ROUND_LOOP", "runtime.fresh_round_loop", False)


def group_meta_direct_tools_enabled() -> bool:
    """``AGX_GROUP_META_DIRECT_TOOLS`` / ``group.meta_direct_tools``. Default False."""
    return _resolve_bool("AGX_GROUP_META_DIRECT_TOOLS", "group.meta_direct_tools", False)
