#!/usr/bin/env python3
"""Turn archive configuration — reads ``memory.turn_archive`` from config.yaml.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.memory.turn_archive")

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "min_chunk_chars": 40,
    "max_chunks_per_turn": 3,
    "recall_turns_limit": 3,
    "halflife_days": 7.0,
}


def _load_yaml_section() -> dict[str, Any]:
    """Load the ``memory.turn_archive`` section from ``~/.agenticx/config.yaml``."""
    config_path = Path.home() / ".agenticx" / "config.yaml"
    if not config_path.is_file():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]

        with config_path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            memory = data.get("memory")
            if isinstance(memory, dict):
                section = memory.get("turn_archive")
                if isinstance(section, dict):
                    return section
    except Exception:
        logger.debug("Failed to load turn_archive config from %s", config_path, exc_info=True)
    return {}


def load_turn_archive_config() -> dict[str, Any]:
    """Return merged config: YAML overrides on top of defaults."""
    merged = dict(DEFAULTS)
    yaml_section = _load_yaml_section()
    for key, value in yaml_section.items():
        if key not in DEFAULTS:
            merged[key] = value
            continue
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
            elif expected_type is float:
                merged[key] = float(value)
            elif expected_type is int:
                merged[key] = int(value)
            else:
                merged[key] = value
        except (ValueError, TypeError):
            logger.warning("Invalid type for memory.turn_archive.%s: %r, using default", key, value)

    env_enabled = os.getenv("AGX_TURN_ARCHIVE_ENABLED")
    if env_enabled is not None:
        merged["enabled"] = env_enabled.strip().lower() in {"1", "true", "on", "yes"}

    return merged


def is_turn_archive_enabled() -> bool:
    """Whether turn archiving and turn recall are active."""
    return bool(load_turn_archive_config().get("enabled"))


CHUNK_RERANK_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "halflife_days": 7.0,
}


def _load_chunk_rerank_section() -> dict[str, Any]:
    """Load the ``memory.chunk_rerank`` section from ``~/.agenticx/config.yaml``."""
    config_path = Path.home() / ".agenticx" / "config.yaml"
    if not config_path.is_file():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]

        with config_path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            memory = data.get("memory")
            if isinstance(memory, dict):
                section = memory.get("chunk_rerank")
                if isinstance(section, dict):
                    return section
    except Exception:
        logger.debug("Failed to load chunk_rerank config from %s", config_path, exc_info=True)
    return {}


def load_chunk_rerank_config() -> dict[str, Any]:
    """Return merged config: YAML overrides on defaults. Env: AGX_CHUNK_RERANK_ENABLED."""
    merged = dict(CHUNK_RERANK_DEFAULTS)
    section = _load_chunk_rerank_section()
    for key, value in section.items():
        if key not in CHUNK_RERANK_DEFAULTS:
            merged[key] = value
            continue
        expected_type = type(CHUNK_RERANK_DEFAULTS[key])
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
            elif expected_type is float:
                merged[key] = float(value)
            else:
                merged[key] = value
        except (ValueError, TypeError):
            logger.warning("Invalid type for memory.chunk_rerank.%s: %r, using default", key, value)

    env_enabled = os.getenv("AGX_CHUNK_RERANK_ENABLED")
    if env_enabled is not None:
        merged["enabled"] = env_enabled.strip().lower() in {"1", "true", "on", "yes"}
    return merged
