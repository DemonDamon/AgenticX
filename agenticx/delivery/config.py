#!/usr/bin/env python3
"""Delivery subsystem configuration — reads ``delivery.*`` from config.yaml.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.delivery")

def _default_worktree_root() -> str:
    """``~/.agenticx/deliveries``，按调用时的 HOME 解析。

    原来直接写在模块级 DEFAULTS 字典里，import 时就求值定死——测试的 HOME 重定向拦不住，
    交付产物会写进开发者真实的 ~/.agenticx/deliveries。见 agenticx/utils/agx_home.py。
    """
    from agenticx.utils.agx_home import agx_home

    return str(agx_home() / "deliveries")


def defaults() -> dict[str, Any]:
    """默认配置。每次调用重新算，不要缓存成模块常量。"""
    return {**DEFAULTS, "worktree_root": _default_worktree_root()}


DEFAULTS: dict[str, Any] = {
    "enabled": True,
    # 占位：真实取值走 defaults() / _default_worktree_root()，见上面的说明。
    "worktree_root": "",
    "bundle_source": "",
    "figma_token": "",
    "playwright_browsers": "chromium",
    "max_stage_retries": 2,
    "repo_root": "",
}


def _load_yaml_section() -> dict[str, Any]:
    config_path = Path.home() / ".agenticx" / "config.yaml"
    if not config_path.is_file():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]

        with config_path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if isinstance(data, dict):
            section = data.get("delivery")
            if isinstance(section, dict):
                return section
    except Exception:
        logger.debug("Failed to load delivery config", exc_info=True)
    return {}


def get_delivery_config() -> dict[str, Any]:
    """Return merged delivery config with env overrides."""
    merged = dict(defaults())  # 走 defaults()：worktree_root 要按当前 HOME 算
    yaml_section = _load_yaml_section()
    for key, value in yaml_section.items():
        if key in DEFAULTS:
            expected = type(DEFAULTS[key])
            if expected is bool and isinstance(value, str):
                merged[key] = value.strip().lower() in {"1", "true", "on", "yes"}
            else:
                try:
                    merged[key] = expected(value) if expected is not bool else bool(value)
                except (TypeError, ValueError):
                    logger.warning("Invalid delivery.%s=%r, using default", key, value)
        else:
            merged[key] = value

    env_enabled = os.getenv("AGX_DELIVERY_ENABLED")
    if env_enabled is not None:
        merged["enabled"] = env_enabled.strip().lower() in {"1", "true", "on", "yes"}
    env_dry = os.getenv("AGX_DELIVERY_DRY_RUN")
    if env_dry is not None:
        merged["dry_run"] = env_dry.strip().lower() in {"1", "true", "on", "yes"}
    elif "dry_run" not in merged:
        merged["dry_run"] = False

    figma_env = os.getenv("FIGMA_API_KEY") or os.getenv("FIGMA_TOKEN")
    if figma_env and not str(merged.get("figma_token") or "").strip():
        merged["figma_token"] = figma_env

    if not str(merged.get("bundle_source") or "").strip():
        merged["bundle_source"] = _default_bundle_source()

    return merged


def save_delivery_config(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge patch into ``delivery`` section of config.yaml."""
    import yaml  # type: ignore[import-untyped]

    config_path = Path.home() / ".agenticx" / "config.yaml"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {}
    if config_path.is_file():
        try:
            loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except Exception:
            logger.debug("Failed to read config for delivery save", exc_info=True)
    section = data.get("delivery")
    if not isinstance(section, dict):
        section = {}
    for key, value in patch.items():
        if key in DEFAULTS or key == "dry_run":
            section[key] = value
    data["delivery"] = section
    config_path.write_text(yaml.dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return get_delivery_config()


def _default_bundle_source() -> str:
    """Resolve bundled delivery kit path inside the AgenticX repo."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "examples" / "agenticx-for-delivery"
        if candidate.is_dir() and (candidate / "agx-bundle.yaml").is_file():
            return str(candidate)
    return ""
