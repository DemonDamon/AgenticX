#!/usr/bin/env python3
"""Resolve a vision-capable fallback model for text-only chat sessions.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.provider_display import format_model_option_label
from agenticx.llms.vision import is_vision_capable


def _provider_enabled(provider_cfg: Dict[str, Any]) -> bool:
    raw = provider_cfg.get("enabled", True)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() not in {"false", "0", "no", "off"}
    if isinstance(raw, (int, float)):
        return bool(raw)
    return True


def _provider_models(provider_cfg: Dict[str, Any]) -> List[str]:
    models: List[str] = []
    raw = provider_cfg.get("models")
    if isinstance(raw, list):
        models.extend(str(m).strip() for m in raw if str(m or "").strip())
    single = str(provider_cfg.get("model") or "").strip()
    if single and single not in models:
        models.append(single)
    return models


def _has_credentials(provider_cfg: Dict[str, Any]) -> bool:
    return bool(
        str(provider_cfg.get("api_key") or "").strip()
        or str(provider_cfg.get("base_url") or "").strip()
    )


def resolve_vision_fallback(session: Any = None) -> Dict[str, Any]:
    """Pick a vision-capable model for the analyze_image tool.

    Order: explicit ``vision_fallback: {provider, model}`` in config.yaml,
    then the current session's provider, then remaining providers in config
    order. Returns {"available", "provider", "model", "label"}.
    """
    try:
        raw_override = ConfigManager.get_value("vision_fallback")
    except Exception:
        raw_override = None
    try:
        cfg = ConfigManager.load()
        providers = cfg.providers if isinstance(cfg.providers, dict) else {}
    except Exception:
        providers = {}

    def _blocked(provider_name: str) -> bool:
        if session is None:
            return False
        try:
            from agenticx.llms.provider_fault import is_provider_session_blocked

            return bool(is_provider_session_blocked(session, provider_name))
        except Exception:
            return False

    def _as_result(provider_name: str, model: str) -> Dict[str, Any]:
        pcfg = providers.get(provider_name)
        label = format_model_option_label(
            provider_name, model, pcfg if isinstance(pcfg, dict) else None
        )
        return {
            "available": True,
            "provider": provider_name,
            "model": model,
            "label": label,
        }

    if isinstance(raw_override, dict):
        ov_provider = str(raw_override.get("provider") or "").strip()
        ov_model = str(raw_override.get("model") or "").strip()
        if (
            ov_provider
            and ov_model
            and is_vision_capable(ov_provider, ov_model)
            and not _blocked(ov_provider)
        ):
            return _as_result(ov_provider, ov_model)

    session_provider = str(getattr(session, "provider_name", "") or "").strip()
    ordered: List[str] = []
    if session_provider and session_provider in providers:
        ordered.append(session_provider)
    ordered.extend(name for name in providers if name not in ordered)

    for provider_name in ordered:
        pcfg = providers.get(provider_name)
        if not isinstance(pcfg, dict):
            continue
        if not _provider_enabled(pcfg) or not _has_credentials(pcfg):
            continue
        if _blocked(provider_name):
            continue
        for model in _provider_models(pcfg):
            if is_vision_capable(provider_name, model):
                return _as_result(provider_name, model)
    return {"available": False, "provider": "", "model": "", "label": ""}
