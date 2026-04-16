#!/usr/bin/env python3
"""Learning subsystem configuration — reads ``learning.*`` from config.yaml.

Centralizes all learning-related config keys with documented defaults so
that other modules (SessionReviewHook, QualityGate, UsageTracker) don't
each re-implement YAML loading.

Config path: ``~/.agenticx/config.yaml`` → ``learning:`` section.

Example config.yaml excerpt::

    learning:
      enabled: true
      nudge_interval: 10        # API turns without skill_manage before review
      min_tool_calls: 5         # minimum tool calls for session review
      auto_create: false        # false = ask user, true = auto with gate
      skip_confirm: false       # true = full auto (no user prompt)
      quality_gate_min_score: 0.6
      review_model: "gpt-4o-mini"
      review_enabled: true      # enable/disable background review hook

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning")

DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "nudge_interval": 10,
    "min_tool_calls": 5,
    "auto_create": False,
    "skip_confirm": False,
    "quality_gate_min_score": 0.6,
    "review_model": "gpt-4o-mini",
    "review_enabled": False,
}


def _load_yaml_section() -> dict[str, Any]:
    """Load the ``learning`` section from ``~/.agenticx/config.yaml``."""
    config_path = Path.home() / ".agenticx" / "config.yaml"
    if not config_path.is_file():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]

        with config_path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            section = data.get("learning")
            if isinstance(section, dict):
                return section
    except Exception:
        logger.debug("Failed to load learning config from %s", config_path, exc_info=True)
    return {}


def get_learning_config() -> dict[str, Any]:
    """Return merged config: YAML overrides on top of defaults.

    Environment variable overrides (highest priority):
      AGX_LEARNING_ENABLED  → learning.enabled
      AGX_SKILL_REVIEW_ENABLED → learning.review_enabled
      AGX_LEARNING_NUDGE_INTERVAL → learning.nudge_interval
      AGX_LEARNING_MIN_TOOL_CALLS → learning.min_tool_calls
    """
    merged = dict(DEFAULTS)
    yaml_section = _load_yaml_section()
    for key, value in yaml_section.items():
        if key in DEFAULTS:
            expected_type = type(DEFAULTS[key])
            try:
                if expected_type is bool:
                    if isinstance(value, bool):
                        merged[key] = value
                    elif isinstance(value, str):
                        lowered = value.strip().lower()
                        if lowered in {"1", "true", "on", "yes"}:
                            merged[key] = True
                        elif lowered in {"0", "false", "off", "no"}:
                            merged[key] = False
                        else:
                            raise ValueError(f"invalid bool: {value!r}")
                    else:
                        raise ValueError(f"invalid bool type: {type(value)!r}")
                else:
                    merged[key] = expected_type(value)
            except (ValueError, TypeError):
                logger.warning("Invalid type for learning.%s: %r, using default", key, value)
        else:
            merged[key] = value

    env_enabled = os.getenv("AGX_LEARNING_ENABLED")
    if env_enabled is not None:
        merged["enabled"] = env_enabled.strip().lower() in {"1", "true", "on", "yes"}

    env_nudge = os.getenv("AGX_LEARNING_NUDGE_INTERVAL")
    if env_nudge is not None:
        try:
            merged["nudge_interval"] = max(1, int(env_nudge))
        except (ValueError, TypeError):
            logger.warning("Invalid AGX_LEARNING_NUDGE_INTERVAL: %r", env_nudge)

    env_min_calls = os.getenv("AGX_LEARNING_MIN_TOOL_CALLS")
    if env_min_calls is not None:
        try:
            merged["min_tool_calls"] = max(1, int(env_min_calls))
        except (ValueError, TypeError):
            logger.warning("Invalid AGX_LEARNING_MIN_TOOL_CALLS: %r", env_min_calls)

    return merged


def get(key: str, default: Any = None) -> Any:
    """Convenience accessor for a single learning config key."""
    config = get_learning_config()
    return config.get(key, default if default is not None else DEFAULTS.get(key))
