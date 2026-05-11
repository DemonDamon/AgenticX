#!/usr/bin/env python3
"""Rough USD pricing per 1M tokens for usage estimates (override via config.yaml).

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import logging

_log = logging.getLogger(__name__)


def _norm_model(model: str) -> str:
    s = (model or "").strip().lower()
    if "/" in s:
        s = s.split("/", 1)[1].strip()
    return s


# USD per 1M tokens: uncached input, output, cached input (same unit as input when unset).
DEFAULT_PRICING: dict[str, dict[str, float]] = {
    # OpenAI-ish (placeholders; tune via config)
    "gpt-5*": {"input": 1.25, "output": 10.0, "cached_input": 0.125},
    "gpt-4o*": {"input": 2.5, "output": 10.0, "cached_input": 1.25},
    "gpt-4o-mini*": {"input": 0.15, "output": 0.6, "cached_input": 0.075},
    "o3*": {"input": 2.0, "output": 8.0, "cached_input": 0.5},
    "o1*": {"input": 15.0, "output": 60.0, "cached_input": 7.5},
    # Anthropic
    "claude-opus*": {"input": 15.0, "output": 75.0, "cached_input": 1.5},
    "claude-sonnet*": {"input": 3.0, "output": 15.0, "cached_input": 0.3},
    "claude-haiku*": {"input": 0.25, "output": 1.25, "cached_input": 0.03},
    "claude-3-5-sonnet*": {"input": 3.0, "output": 15.0, "cached_input": 0.3},
    # Alibaba / DashScope
    "qwen*": {"input": 0.4, "output": 1.2, "cached_input": 0.04},
    # Zhipu
    "glm*": {"input": 0.1, "output": 0.1, "cached_input": 0.02},
    # Moonshot / Kimi
    "kimi*": {"input": 0.3, "output": 1.5, "cached_input": 0.03},
    # MiniMax
    "abab*": {"input": 0.15, "output": 0.6, "cached_input": 0.015},
    "minimax*": {"input": 0.15, "output": 0.6, "cached_input": 0.015},
    # DeepSeek
    "deepseek*": {"input": 0.14, "output": 0.28, "cached_input": 0.014},
    # Ollama / local (no bill by default)
    "ollama*": {"input": 0.0, "output": 0.0, "cached_input": 0.0},
    "*": {"input": 0.5, "output": 2.0, "cached_input": 0.05},
}


def _load_yaml_pricing_models() -> dict[str, dict[str, float]]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
        project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
        merged = ConfigManager._deep_merge(global_data, project_data)
        pricing = merged.get("pricing") if isinstance(merged, dict) else None
        if not isinstance(pricing, dict):
            return {}
        raw_models = pricing.get("models")
        if not isinstance(raw_models, dict):
            return {}
        out: dict[str, dict[str, float]] = {}
        for name, row in raw_models.items():
            key = str(name or "").strip().lower()
            if not key:
                continue
            if not isinstance(row, dict):
                continue
            try:
                inp = float(row.get("input", 0) or 0)
                outp = float(row.get("output", 0) or 0)
                cached_inp = float(row.get("cached_input", inp * 0.1) or 0)
            except (TypeError, ValueError):
                continue
            out[key] = {"input": inp, "output": outp, "cached_input": cached_inp}
        return out
    except Exception as exc:
        _log.debug("load_yaml_pricing_models skipped: %s", exc)
        return {}


def _match_default_row(norm: str) -> dict[str, float]:
    # Exact keys in DEFAULT_PRICING without glob first
    if norm in DEFAULT_PRICING and "*" not in norm:
        return dict(DEFAULT_PRICING[norm])
    for pattern, row in DEFAULT_PRICING.items():
        if "*" not in pattern:
            continue
        if fnmatch.fnmatch(norm, pattern.replace("*", "*")):
            return dict(row)
    return dict(DEFAULT_PRICING["*"])


def resolve_model_rates(model: str) -> dict[str, float]:
    """Return per-1M-token USD rates for input, output, cached_input."""
    norm = _norm_model(model)
    overrides = _load_yaml_pricing_models()
    if norm in overrides:
        return dict(overrides[norm])
    for ov_key, row in overrides.items():
        ok = str(ov_key or "").strip().lower()
        if not ok:
            continue
        if "*" in ok or "?" in ok:
            if fnmatch.fnmatch(norm, ok):
                return dict(row)
        elif ok == norm:
            return dict(row)
    return _match_default_row(norm)


def compute_cost_usd(
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
) -> float:
    """Estimate USD cost for one completion."""
    inp = max(0, int(input_tokens or 0))
    out = max(0, int(output_tokens or 0))
    cached = max(0, int(cached_tokens or 0))
    uncached_inp = max(0, inp - cached)
    rates = resolve_model_rates(model)
    ri = float(rates.get("input", 0.0))
    ro = float(rates.get("output", 0.0))
    rc = float(rates.get("cached_input", ri * 0.1))
    cost = (uncached_inp / 1_000_000.0) * ri + (cached / 1_000_000.0) * rc + (out / 1_000_000.0) * ro
    return round(cost, 6)
