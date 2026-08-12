#!/usr/bin/env python3
"""Shared sampling-parameter helpers for chat LLM calls.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Mapping, Optional


def _bare_model_id(model: str) -> str:
    name = str(model or "").strip().lower()
    if "/" in name:
        name = name.rsplit("/", 1)[-1]
    return name


def model_requires_fixed_temperature_one(model: str) -> bool:
    """True for OpenAI gpt-5 reasoning SKUs that reject non-1 temperature.

    LiteLLM raises UnsupportedParamsError when temperature != 1 for these
    models. ``gpt-5-chat*`` is excluded (regular chat sampling is allowed).
    """
    bare = _bare_model_id(model)
    if not bare:
        return False
    if "gpt-5-chat" in bare:
        return False
    return "gpt-5" in bare


def resolve_chat_temperature(
    model: str,
    *,
    provider: str = "",
    default: float = 0.2,
) -> Optional[float]:
    """Return temperature for a chat round, or None to omit the param.

    - MiniMax: omit (vendor rejects arbitrary sampling values on some SKUs)
    - gpt-5 reasoning family: force 1.0
    - otherwise: ``default`` (historically 0.2 for Studio/runtime)
    """
    if str(provider or "").strip().lower() == "minimax":
        return None
    if model_requires_fixed_temperature_one(model):
        return 1.0
    return float(default)


def provider_raw_enabled_for_fallback(raw: Optional[Mapping[str, Any]]) -> bool:
    """False only when config explicitly sets ``enabled: false``.

    Used by chat LLM auto-fallback so disabled catalog entries (still present
    in ``config.yaml`` with keys) are not silently selected.
    """
    if not isinstance(raw, Mapping):
        return True
    return raw.get("enabled") is not False
