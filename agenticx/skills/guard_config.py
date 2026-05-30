#!/usr/bin/env python3
"""Skill guard configuration loader.

Author: Damon Li
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

ScanMode = Literal["quick", "standard", "full"]


@dataclass
class GuardConfig:
    """Runtime knobs for skill security scanning."""

    version: int = 1
    scan_mode: ScanMode = "standard"
    llm_verify: bool = False
    scan_timeout_seconds: float = 30.0


def load_guard_config() -> GuardConfig:
    """Load guard settings from env and ~/.agenticx/config.yaml skills.guard."""
    cfg = GuardConfig()
    env_ver = os.environ.get("AGX_SKILL_GUARD_VERSION", "").strip()
    if env_ver.isdigit():
        cfg.version = int(env_ver)
    env_mode = os.environ.get("AGX_SKILL_GUARD_SCAN_MODE", "").strip().lower()
    if env_mode in {"quick", "standard", "full"}:
        cfg.scan_mode = env_mode  # type: ignore[assignment]
    env_llm = os.environ.get("AGX_SKILL_GUARD_LLM_VERIFY", "").strip().lower()
    if env_llm in {"1", "true", "yes", "on"}:
        cfg.llm_verify = True
    elif env_llm in {"0", "false", "no", "off"}:
        cfg.llm_verify = False
    try:
        from agenticx.cli.config_manager import ConfigManager

        section = ConfigManager.get_value("skills.guard")
        if isinstance(section, dict):
            if section.get("version") is not None and not env_ver.isdigit():
                cfg.version = int(section["version"])
            mode = str(section.get("scan_mode") or "").strip().lower()
            if mode in {"quick", "standard", "full"} and not env_mode:
                cfg.scan_mode = mode  # type: ignore[assignment]
            if "llm_verify" in section and env_llm not in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
                cfg.llm_verify = bool(section["llm_verify"])
            if section.get("scan_timeout_seconds") is not None:
                cfg.scan_timeout_seconds = max(5.0, float(section["scan_timeout_seconds"]))
    except Exception:
        pass
    return cfg


def guard_settings_payload() -> dict[str, object]:
    """Serialize guard settings for API responses."""
    cfg = load_guard_config()
    return {
        "version": cfg.version,
        "scan_mode": cfg.scan_mode,
        "llm_verify": cfg.llm_verify,
        "scan_timeout_seconds": cfg.scan_timeout_seconds,
    }


def persist_guard_settings(
    *,
    version: int | None = None,
    scan_mode: str | None = None,
    llm_verify: bool | None = None,
) -> None:
    """Persist guard settings to ~/.agenticx/config.yaml skills.guard."""
    from agenticx.cli.config_manager import ConfigManager

    current = ConfigManager.get_value("skills.guard")
    section: dict[str, object] = dict(current) if isinstance(current, dict) else {}
    if version is not None:
        section["version"] = int(version)
    if scan_mode is not None and scan_mode in {"quick", "standard", "full"}:
        section["scan_mode"] = scan_mode
    if llm_verify is not None:
        section["llm_verify"] = bool(llm_verify)
    ConfigManager.set_value("skills.guard", section)
