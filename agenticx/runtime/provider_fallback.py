#!/usr/bin/env python3
"""Provider fallback helpers when LLM calls stall or time out.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional, Tuple

_log = logging.getLogger(__name__)

FALLBACK_MODELS: list[dict[str, str]] = [
    {"provider": "deepseek", "model": "deepseek-chat", "label": "DeepSeek / deepseek-chat"},
    {"provider": "zhipu", "model": "glm-4-flash", "label": "智谱 / glm-4-flash"},
    {"provider": "openai", "model": "gpt-4o-mini", "label": "OpenAI / gpt-4o-mini"},
]

#: Desktop 把企业下发的模型挂在这一个 provider 下，模型名是 ``<provider>/<model>``。
ENTERPRISE_PROVIDER = "enterprise"

SCRATCH_TIMEOUT_STREAK_KEY = "_llm_provider_timeout_streak"
SCRATCH_FALLBACK_APPLIED_KEY = "_llm_fallback_applied"


def llm_fallback_enabled() -> bool:
    raw = os.getenv("AGX_LLM_FALLBACK_ENABLED", "").strip().lower()
    if raw in {"0", "false", "off", "no"}:
        return False
    if raw in {"1", "true", "on", "yes"}:
        return True
    try:
        from agenticx.cli.config_manager import ConfigManager

        val = ConfigManager.get_value("runtime.llm_fallback_enabled")
        if val is not None:
            return bool(val)
    except Exception:
        pass
    return True


def _scratchpad(session: Any) -> dict:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        sp = {}
        setattr(session, "scratchpad", sp)
    return sp


def record_provider_timeout(session: Any) -> int:
    sp = _scratchpad(session)
    streak = int(sp.get(SCRATCH_TIMEOUT_STREAK_KEY, 0) or 0) + 1
    sp[SCRATCH_TIMEOUT_STREAK_KEY] = streak
    return streak


def reset_provider_timeout_streak(session: Any) -> None:
    sp = _scratchpad(session)
    sp.pop(SCRATCH_TIMEOUT_STREAK_KEY, None)


def fallback_forbidden_reason(session: Any) -> str:
    """Why this session must never be silently moved to another provider.

    ``FALLBACK_MODELS`` 里全是公网厂商。对两类会话来说，超时换家不是降级，
    而是把对话搬出了它被要求待着的地方：

    - 附件路由锁住的会话：文档正因为要留在私有部署才把模型钉住。
    - 企业托管会话：走哪个模型是管理员的决定，不是超时兜底能改的。

    探测本身出错时按「禁止兜底」处理：最坏结果只是把原始错误照实报上去。
    """
    try:
        from agenticx.studio.attachment_routing import session_locked_target

        if session_locked_target(session) is not None:
            return "attachment-routing lock"
    except Exception:
        return "containment probe failed"
    try:
        if _enterprise_managed_in_global_config(getattr(session, "provider_name", None)):
            return "enterprise-managed provider"
    except Exception:
        return "containment probe failed"
    return ""


def _enterprise_managed_in_global_config(provider_name: Any) -> bool:
    """只读全局用户配置，**不走 ``ConfigManager.get_value()``**。"""
    provider = str(provider_name or "").strip()
    if not provider:
        return False
    if provider == ENTERPRISE_PROVIDER:
        return True
    from agenticx.cli.config_manager import ConfigManager

    global_config = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    providers = (global_config or {}).get("providers")
    if not isinstance(providers, dict):
        return False
    entry = providers.get(provider)
    return isinstance(entry, dict) and entry.get("managed") is True


def maybe_apply_provider_fallback(session: Any) -> Tuple[bool, str]:
    """After consecutive timeouts, switch session to a fast fallback model.

    Returns (applied, human_message).
    """
    if not llm_fallback_enabled():
        return False, ""
    forbidden = fallback_forbidden_reason(session)
    if forbidden:
        _log.warning(
            "provider fallback refused (%s): keeping provider=%s model=%s",
            forbidden,
            getattr(session, "provider_name", ""),
            getattr(session, "model_name", ""),
        )
        return False, ""
    if bool(_scratchpad(session).get(SCRATCH_FALLBACK_APPLIED_KEY)):
        return False, ""
    streak = int(_scratchpad(session).get(SCRATCH_TIMEOUT_STREAK_KEY, 0) or 0)
    if streak < 2:
        return False, ""

    current_provider = str(getattr(session, "provider_name", "") or "").strip().lower()
    current_model = str(getattr(session, "model_name", "") or "").strip().lower()
    for entry in FALLBACK_MODELS:
        prov = entry["provider"].lower()
        model = entry["model"].lower()
        if prov == current_provider and model == current_model:
            continue
        session.provider_name = entry["provider"]
        session.model_name = entry["model"]
        sp = _scratchpad(session)
        sp[SCRATCH_FALLBACK_APPLIED_KEY] = entry["label"]
        sp[SCRATCH_TIMEOUT_STREAK_KEY] = 0
        msg = f"已自动切换至备用模型：{entry['label']}"
        return True, msg
    return False, ""


def resolve_provider_read_timeout(session: Any) -> float:
    """Connect/read timeout for provider HTTP calls."""
    env_raw = os.getenv("AGX_LLM_PROVIDER_READ_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_provider_read_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return _resolve_llm_round_timeout_seconds_from_config()


def _resolve_llm_round_timeout_seconds_from_config() -> float:
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_round_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return 180.0
