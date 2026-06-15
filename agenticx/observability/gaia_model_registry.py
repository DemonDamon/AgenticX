#!/usr/bin/env python3
"""GAIA benchmark allowed models and provider resolution.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from agenticx.cli.config_manager import ConfigManager

# Curated models exposed to /rungaia (Near Desktop picker parity).
GAIA_ALLOWED_MODELS: tuple[str, ...] = (
    "gpt-5.5",
    "gpt-5.4",
    "kimi-k2.6",
    "glm-5.1",
    "glm-5.2",
    "MiniMax-M2.7",
    "MiniMax-M3",
    "qwen3.6-plus",
    "qwen3.7-max",
)

_DEFAULT_PROVIDER_BY_MODEL: dict[str, str] = {
    "gpt-5.5": "openai",
    "gpt-5.4": "openai",
    "kimi-k2.6": "kimi",
    "glm-5.1": "zhipu",
    "glm-5.2": "zhipu",
    "minimax-m2.7": "minimax",
    "minimax-m3": "minimax",
    "qwen3.6-plus": "bailian",
    "qwen3.7-max": "bailian",
}


@dataclass(frozen=True)
class GaiaModelSelection:
    """Resolved GAIA model + provider pair."""

    model: str
    provider: str


def normalize_model_id(model: str) -> str:
    """Return canonical model id from allowed list (case-insensitive)."""
    raw = str(model or "").strip()
    if not raw:
        raise ValueError("model is required")
    lowered = raw.lower()
    for candidate in GAIA_ALLOWED_MODELS:
        if candidate.lower() == lowered:
            return candidate
    allowed = ", ".join(GAIA_ALLOWED_MODELS)
    raise ValueError(f"unsupported model '{raw}'. Allowed: {allowed}")


def list_provider_model_ids(provider_cfg: dict) -> list[str]:
    """Collect model ids configured under one provider entry."""
    models_raw = provider_cfg.get("models")
    ids: list[str] = []
    if isinstance(models_raw, list):
        ids.extend(str(item).strip() for item in models_raw if str(item).strip())
    single = str(provider_cfg.get("model") or "").strip()
    if single:
        ids.append(single)
    return ids


def find_provider_for_model(model: str) -> str | None:
    """Find provider name from ~/.agenticx/config.yaml that lists this model."""
    canonical = normalize_model_id(model)
    target = canonical.lower()
    config = ConfigManager.load()
    for provider_name, provider_cfg in (config.providers or {}).items():
        if not isinstance(provider_cfg, dict):
            continue
        for configured in list_provider_model_ids(provider_cfg):
            if configured.lower() == target:
                return str(provider_name).strip().lower()
    return None


def resolve_gaia_model(model: str, *, provider_override: str | None = None) -> GaiaModelSelection:
    """Resolve model and provider for GAIA benchmark execution."""
    canonical = normalize_model_id(model)
    if provider_override:
        provider = str(provider_override).strip().lower()
        if not provider:
            raise ValueError("provider override must be non-empty")
        return GaiaModelSelection(model=canonical, provider=provider)

    from_config = find_provider_for_model(canonical)
    if from_config:
        return GaiaModelSelection(model=canonical, provider=from_config)

    default_provider = _DEFAULT_PROVIDER_BY_MODEL.get(canonical.lower())
    if default_provider:
        return GaiaModelSelection(model=canonical, provider=default_provider)

    raise ValueError(
        f"cannot resolve provider for model '{canonical}'; "
        "configure the model under a provider in ~/.agenticx/config.yaml or pass --provider"
    )


def format_allowed_models() -> str:
    """Human-readable allowed model list."""
    return ", ".join(GAIA_ALLOWED_MODELS)


def iter_allowed_models() -> Iterable[str]:
    """Iterate allowed GAIA model ids."""
    return iter(GAIA_ALLOWED_MODELS)


def _provider_config(provider_name: str) -> dict:
    config = ConfigManager.load()
    raw = (config.providers or {}).get(provider_name.lower(), {})
    return raw if isinstance(raw, dict) else {}


def verify_provider_ready(selection: GaiaModelSelection) -> None:
    """Fail fast when provider credentials are missing before a long GAIA run."""
    cfg = _provider_config(selection.provider)
    api_key = str(cfg.get("api_key") or "").strip()
    base_url = str(cfg.get("base_url") or "").strip()
    enabled = cfg.get("enabled", True)

    if enabled is False:
        raise ValueError(
            f"provider '{selection.provider}' is disabled in ~/.agenticx/config.yaml; "
            "enable it in Near settings first"
        )

    # Ollama and similar local gateways may work with base_url only.
    if selection.provider == "ollama":
        if not base_url:
            raise ValueError(
                f"provider 'ollama' needs base_url in ~/.agenticx/config.yaml "
                f"before running model '{selection.model}'"
            )
        return

    if not api_key and not base_url:
        raise ValueError(
            f"provider '{selection.provider}' has no api_key/base_url in ~/.agenticx/config.yaml. "
            f"Configure MiniMax (or your gateway) API key in Near → Settings → Models, then retry "
            f"model '{selection.model}'."
        )
