#!/usr/bin/env python3
"""Prompt cache policy helpers for runtime LLM calls.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from agenticx.cli.config_manager import ConfigManager

IMPLICIT_PREFIX_CACHE_PROVIDERS = frozenset({"kimi", "moonshot"})


def _is_implicit_prefix_provider(provider_name: str) -> bool:
    provider = str(provider_name or "").strip().lower()
    return any(token == provider or token in provider for token in IMPLICIT_PREFIX_CACHE_PROVIDERS)


@dataclass
class PromptCacheConfig:
    """Runtime prompt cache configuration resolved from config.yaml."""

    enabled: bool = False
    provider_allowlist: List[str] | None = None
    min_cacheable_chars: int = 800
    segment_strategy: str = "stable_prefix"
    max_breakpoints: int = 4
    tool_result_breakpoints: int = 3
    context_management_enabled: bool = False
    context_management_beta: str = "compact-2026-01-12"
    context_management_mode: str = "auto"

    def allows_provider(self, provider_name: str) -> bool:
        provider = str(provider_name or "").strip().lower()
        allow = [str(x or "").strip().lower() for x in (self.provider_allowlist or []) if str(x or "").strip()]
        if not allow:
            return provider == "anthropic"
        return provider in allow


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_prompt_cache_config() -> PromptCacheConfig:
    """Load prompt cache config from runtime.prompt_cache.*."""
    raw = ConfigManager.get_value("runtime.prompt_cache")
    if not isinstance(raw, dict):
        raw = {}
    cfg = PromptCacheConfig(
        enabled=bool(raw.get("enabled", False)),
        provider_allowlist=list(raw.get("provider_allowlist", []) or []),
        min_cacheable_chars=max(0, _as_int(raw.get("min_cacheable_chars", 800), 800)),
        segment_strategy=str(raw.get("segment_strategy", "stable_prefix") or "stable_prefix").strip().lower(),
        max_breakpoints=max(1, _as_int(raw.get("max_breakpoints", 4), 4)),
        tool_result_breakpoints=max(0, _as_int(raw.get("tool_result_breakpoints", 3), 3)),
        context_management_enabled=bool(raw.get("context_management_enabled", False)),
        context_management_beta=str(raw.get("context_management_beta", "compact-2026-01-12") or "compact-2026-01-12").strip(),
        context_management_mode=str(raw.get("context_management_mode", "auto") or "auto").strip(),
    )
    return cfg


def _message_chars(message: Dict[str, Any]) -> int:
    content = message.get("content")
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        return len(str(content))
    return len(str(content or ""))


def _clear_cache_markers(messages: Sequence[Dict[str, Any]]) -> None:
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        msg.pop("cache_control", None)


def apply_prompt_cache_breakpoints(
    messages: Sequence[Dict[str, Any]],
    *,
    provider_name: str,
    cfg: PromptCacheConfig,
) -> Tuple[List[Dict[str, Any]], Dict[str, int | str]]:
    """Apply prompt cache markers to stable message segments.

    Returns:
        (possibly-updated messages, telemetry stats)
    """
    telemetry: Dict[str, int | str] = {
        "cache_mode": "disabled",
        "cache_breakpoints": 0,
        "cache_eligible_chars": 0,
    }
    out = [m for m in messages if isinstance(m, dict)]
    _clear_cache_markers(out)

    if _is_implicit_prefix_provider(provider_name):
        telemetry["cache_mode"] = "implicit_prefix"
        return out, telemetry
    if not cfg.enabled:
        return out, telemetry
    if not cfg.allows_provider(provider_name):
        telemetry["cache_mode"] = "unsupported_provider"
        return out, telemetry

    telemetry["cache_mode"] = "enabled"
    candidates: List[int] = []

    if out and str(out[0].get("role", "")).lower() == "system":
        if _message_chars(out[0]) >= cfg.min_cacheable_chars:
            candidates.append(0)

    if cfg.tool_result_breakpoints > 0:
        found = 0
        for idx in range(len(out) - 1, -1, -1):
            role = str(out[idx].get("role", "")).strip().lower()
            if role != "tool":
                continue
            if _message_chars(out[idx]) < cfg.min_cacheable_chars:
                continue
            candidates.append(idx)
            found += 1
            if found >= cfg.tool_result_breakpoints:
                break

    candidates = sorted(set(candidates))[: cfg.max_breakpoints]
    eligible = 0
    for idx in candidates:
        msg = out[idx]
        msg["cache_control"] = {"type": "ephemeral"}
        eligible += _message_chars(msg)
    telemetry["cache_breakpoints"] = len(candidates)
    telemetry["cache_eligible_chars"] = eligible
    return out, telemetry


def _fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:12]


def build_prefix_fingerprints(
    messages: Sequence[Dict[str, Any]],
    tools: Sequence[Dict[str, Any]] | None,
) -> Dict[str, Any]:
    """Fingerprint the exact request prefix so cache misses are explainable.

    Vendor prefix caches key on ``tools`` → system → messages. A single byte of
    per-turn churn anywhere in that order voids every hit downstream, and the
    ledger can only report the resulting 0%. Recording per-row hashes lets a
    later turn be diffed against an earlier one to find the row that moved.
    """
    tools_json = json.dumps(list(tools or []), ensure_ascii=False, sort_keys=True)
    rows: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        text = content if isinstance(content, str) else json.dumps(
            content, ensure_ascii=False, sort_keys=True, default=str
        )
        rows.append(
            {
                "role": str(msg.get("role", "")),
                "chars": len(text),
                "fp": _fingerprint(text),
            }
        )
    return {
        "tools_count": len(list(tools or [])),
        "tools_chars": len(tools_json),
        "tools_fp": _fingerprint(tools_json),
        "messages": rows,
    }


def persist_prefix_fingerprints(session: Any, payload: Dict[str, Any]) -> None:
    """Append one prefix-fingerprint line to the session directory."""
    sid = getattr(session, "_session_id", None) or getattr(session, "session_id", None)
    text = str(sid or "").strip()
    if not text:
        return
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    out_path = Path.home() / ".agenticx" / "sessions" / safe / "cache_prefix.jsonl"
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass


def build_context_management_kwargs(
    *,
    provider_name: str,
    cfg: PromptCacheConfig,
) -> Dict[str, Any]:
    """Build optional server-side context management kwargs."""
    if not cfg.context_management_enabled:
        return {}
    if not cfg.allows_provider(provider_name):
        return {}
    extra_body = {"context_management": {"mode": cfg.context_management_mode}}
    kwargs: Dict[str, Any] = {"extra_body": extra_body}
    beta = str(cfg.context_management_beta or "").strip()
    if beta:
        kwargs["betas"] = [beta]
    return kwargs

