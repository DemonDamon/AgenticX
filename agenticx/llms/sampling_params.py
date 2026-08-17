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
    fallback_model: str = "",
) -> Optional[float]:
    """Return temperature for a chat round, or None to omit the param.

    - MiniMax: omit (vendor rejects arbitrary sampling values on some SKUs)
    - gpt-5 reasoning family: force 1.0
    - otherwise: ``default`` (historically 0.2 for Studio/runtime)

    ``fallback_model`` is used when the session model name is empty but the
    live LLM instance still has a concrete model id (common on IM-bound
    sessions that never persisted provider/model).
    """
    effective = str(model or "").strip() or str(fallback_model or "").strip()
    if str(provider or "").strip().lower() == "minimax":
        return None
    if model_requires_fixed_temperature_one(effective):
        return 1.0
    return float(default)


def sanitize_chat_call_kwargs(
    kwargs: dict[str, Any],
    model: str,
    *,
    provider: str = "",
    fallback_model: str = "",
) -> dict[str, Any]:
    """Rewrite call kwargs so vendor temperature constraints are honored."""
    value = resolve_chat_temperature(
        model,
        provider=provider,
        fallback_model=fallback_model,
    )
    if value is None:
        kwargs.pop("temperature", None)
        return kwargs
    effective = str(model or "").strip() or str(fallback_model or "").strip()
    if model_requires_fixed_temperature_one(effective):
        kwargs["temperature"] = float(value)
    return kwargs


def provider_raw_enabled_for_fallback(raw: Optional[Mapping[str, Any]]) -> bool:
    """False only when config explicitly sets ``enabled: false``.

    Used by chat LLM auto-fallback so disabled catalog entries (still present
    in ``config.yaml`` with keys) are not silently selected.
    """
    if not isinstance(raw, Mapping):
        return True
    return raw.get("enabled") is not False
