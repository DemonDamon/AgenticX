"""Smoke tests for ToolSearch adaptive threshold runtime wiring."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.tool_search import (
    TOOL_SEARCH_DECISION_KEY,
    ToolSearchConfig,
    estimate_schema_tokens,
)
from agenticx.runtime.tool_search_runtime import build_runtime_context


def _openai(name: str, *, desc: str = "d", props: dict | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": props or {},
            },
        },
    }


def _full_pool() -> list[dict]:
    return [
        _openai("bash_exec"),
        _openai("tool_search"),
        _openai("web_search"),
        _openai("file_read"),
    ]


def test_build_runtime_context_adaptive_threshold_by_model():
    session = SimpleNamespace(model_name="claude-sonnet-5", scratchpad={}, mcp_hub=None)
    ctx = build_runtime_context(session=session, full_openai_tools=_full_pool())
    assert ctx.effective_threshold == 10_000
    assert session.scratchpad[TOOL_SEARCH_DECISION_KEY]["context_window"] == 200_000

    session2 = SimpleNamespace(model_name="qwen-plus", scratchpad={}, mcp_hub=None)
    ctx2 = build_runtime_context(session=session2, full_openai_tools=_full_pool())
    assert ctx2.effective_threshold == 6400


def test_build_runtime_context_hysteresis_latch():
    # Build a pool large enough that adaptive would apply for 128k (threshold 6400).
    fat_props = {f"p{i}": {"type": "string", "description": "x" * 80} for i in range(80)}
    large_pool = [
        _openai("bash_exec"),
        _openai("tool_search"),
        _openai("web_search", props=fat_props),
        _openai("web_fetch", props=fat_props),
        _openai("code_search", props=fat_props),
    ]
    pool_tokens = estimate_schema_tokens(large_pool)
    assert pool_tokens >= 6400

    # Latch ON then drop slightly below threshold but stay above 0.8x → remain applied.
    session = SimpleNamespace(
        model_name="qwen-plus",
        scratchpad={TOOL_SEARCH_DECISION_KEY: {"applied": True}},
        mcp_hub=None,
    )
    medium_pool: list[dict] | None = None
    for n_props in range(40, 200):
        props = {f"p{i}": {"type": "string", "description": "x" * 80} for i in range(n_props)}
        candidate = [
            _openai("bash_exec"),
            _openai("tool_search"),
            _openai("web_search", props=props),
            _openai("web_fetch", props=props),
            _openai("code_search", props=props),
        ]
        tokens = estimate_schema_tokens(candidate)
        if 5120 <= tokens < 6400:
            medium_pool = candidate
            break
    assert medium_pool is not None, "failed to synthesize medium pool in hysteresis band"
    ctx = build_runtime_context(
        session=session,
        full_openai_tools=medium_pool,
        config=ToolSearchConfig(mode="auto"),
    )
    assert ctx.resolved_applied is True

    # Drop clear of the band (< 0.8x) → flip off.
    tiny_pool = [_openai("bash_exec"), _openai("tool_search")]
    session2 = SimpleNamespace(
        model_name="qwen-plus",
        scratchpad={TOOL_SEARCH_DECISION_KEY: {"applied": True}},
        mcp_hub=None,
    )
    tiny_tokens = estimate_schema_tokens(tiny_pool)
    assert tiny_tokens < 5120, tiny_tokens
    ctx2 = build_runtime_context(
        session=session2,
        full_openai_tools=tiny_pool,
        config=ToolSearchConfig(mode="auto"),
    )
    assert ctx2.resolved_applied is False
