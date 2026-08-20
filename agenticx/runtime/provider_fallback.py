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

#: 桌面端把所有企业模型挂在这一个 provider 下（见 desktop/electron/main.ts
#: applyEnterpriseProvider），模型名是 ``<provider>/<model>``。
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

    ``FALLBACK_MODELS`` 里全是公网厂商。对两类会话来说，"超时了就换一家"不是降级
    而是**把对话搬出了它被要求待着的地方**：

    - 附件路由锁住的会话：一份文档正因为要留在私有化部署里才把模型钉到私有 Qwen，
      历史里已经有文档正文了。私有端点超时两次就把整段搬去公网 DeepSeek，正好是
      这个特性存在的理由被绕开。
    - 企业托管会话：走哪个模型是管理员的决定，不是超时兜底能改的。而且这里是直接
      赋值 provider_name / model_name，绕过 address_for_session()，连寻址都会写坏。

    探测本身出错时按"禁止兜底"处理：最坏结果只是把原始错误照实报上去，比静默换家安全。
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
    """只读全局用户配置，**不走 ``ConfigManager.get_value()``**。

    和附件路由同一条纪律，而且这里已经被验证过不是假想：本仓库工作目录下就有一份
    项目级 config，``get_value("providers")`` 返回的字典里**根本没有 enterprise
    这一项**——用它判断会稳定得出「不是托管会话」，守卫直接失效。
    """
    provider = str(provider_name or "").strip()
    if not provider:
        return False
    # 企业挂载点本身，不看配置里还有没有它。企业退登会把 providers.enterprise 整个
    # 删掉（实测见过：token 清空、模型目录归零），如果只按配置判断，恰好在这个状态下
    # 守卫会失效——而那正是最需要它的时刻。
    if provider == ENTERPRISE_PROVIDER:
        return True
    from agenticx.cli.config_manager import ConfigManager

    # 读失败让异常抛出去：调用方按"禁止兜底"处理，比静默换家安全。
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
        # 不换家。让上游那个真实错误照实浮上去，而不是被兜底模型的失败盖住
        # ——用户看到的会是 "deepseek 没有 api_key"，而真正超时的是企业网关。
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
