#!/usr/bin/env python3
"""Unit tests for prompt cache policy helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.prompt_cache_policy import (
    PromptCacheConfig,
    apply_prompt_cache_breakpoints,
    build_context_management_kwargs,
)


def test_apply_prompt_cache_breakpoints_layout() -> None:
    cfg = PromptCacheConfig(
        enabled=True,
        provider_allowlist=["anthropic"],
        min_cacheable_chars=5,
        max_breakpoints=4,
        tool_result_breakpoints=3,
    )
    messages = [
        {"role": "system", "content": "system rules for cache"},
        {"role": "user", "content": "q1"},
        {"role": "tool", "content": "tool result 1"},
        {"role": "tool", "content": "tool result 2"},
        {"role": "tool", "content": "tool result 3"},
    ]
    out, telemetry = apply_prompt_cache_breakpoints(messages, provider_name="anthropic", cfg=cfg)
    marked = [idx for idx, item in enumerate(out) if item.get("cache_control")]
    assert marked == [0, 2, 3, 4]
    assert telemetry["cache_mode"] == "enabled"
    assert int(telemetry["cache_breakpoints"]) == 4
    assert int(telemetry["cache_eligible_chars"]) > 0


def test_apply_prompt_cache_breakpoints_unsupported_provider() -> None:
    cfg = PromptCacheConfig(enabled=True, provider_allowlist=["anthropic"])
    messages = [{"role": "system", "content": "abc" * 400}]
    out, telemetry = apply_prompt_cache_breakpoints(messages, provider_name="openai", cfg=cfg)
    assert out[0].get("cache_control") is None
    assert telemetry["cache_mode"] == "unsupported_provider"


def test_build_context_management_kwargs() -> None:
    cfg = PromptCacheConfig(
        enabled=True,
        provider_allowlist=["anthropic"],
        context_management_enabled=True,
        context_management_beta="compact-2026-01-12",
        context_management_mode="auto",
    )
    kwargs = build_context_management_kwargs(provider_name="anthropic", cfg=cfg)
    assert kwargs["extra_body"]["context_management"]["mode"] == "auto"
    assert kwargs["betas"] == ["compact-2026-01-12"]

