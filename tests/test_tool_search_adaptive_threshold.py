"""Unit tests for ToolSearch adaptive threshold + hysteresis."""

from __future__ import annotations

from agenticx.runtime.tool_search import (
    ToolSearchConfig,
    ToolSearchRuntimeContext,
    ToolSearchStateV1,
    build_catalog,
    decide_apply_with_hysteresis,
    is_tool_pending_next_round,
    project_tools_for_round,
    resolve_apply_threshold,
    resolve_effective_threshold,
    resolve_max_loaded,
    should_apply_tool_search,
    ToolDescriptor,
)


def _openai(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": "d",
            "parameters": {"type": "object", "properties": {}},
        },
    }


def _builtin(name: str) -> ToolDescriptor:
    return ToolDescriptor(
        stable_id=f"builtin:{name}",
        name=name,
        kind="builtin",
        description=f"Builtin {name}",
        input_schema={"type": "object", "properties": {}},
    )


def test_resolve_effective_threshold_adaptive_windows():
    cfg = ToolSearchConfig(mode="auto")
    assert resolve_effective_threshold(cfg, context_window=128_000) == 6400
    assert resolve_effective_threshold(cfg, context_window=200_000) == 10_000
    assert resolve_effective_threshold(cfg, context_window=1_048_576) == 50_000
    assert resolve_effective_threshold(cfg, context_window=8_000) == 1_000


def test_resolve_apply_threshold_ignores_window_and_strategy():
    assert resolve_apply_threshold(ToolSearchConfig(mode="auto")) == 6000
    assert (
        resolve_apply_threshold(ToolSearchConfig(mode="auto", auto_schema_token_threshold=8000))
        == 8000
    )
    assert (
        resolve_apply_threshold(
            ToolSearchConfig(
                mode="auto",
                threshold_strategy="manual",
                auto_schema_token_threshold=1000,
            )
        )
        == 1000
    )


def test_adaptive_1m_window_applies_when_pool_exceeds_schema_gate():
    """1M windows must not use the 50k loaded-budget as the apply gate."""
    cfg = ToolSearchConfig(mode="auto")
    budget = resolve_effective_threshold(cfg, context_window=1_000_000)
    assert budget == 50_000
    apply_thr = resolve_apply_threshold(cfg)
    assert apply_thr == 6000
    assert (
        should_apply_tool_search(
            cfg,
            full_pool_schema_tokens=19_315,
            tool_search_allowed=True,
            effective_threshold=apply_thr,
        )
        is True
    )
    assert (
        should_apply_tool_search(
            cfg,
            full_pool_schema_tokens=19_315,
            tool_search_allowed=True,
            effective_threshold=budget,
        )
        is False
    )


def test_resolve_applied_uses_apply_threshold_not_window_budget():
    catalog = build_catalog(
        [_builtin("bash_exec"), _builtin("web_fetch"), _builtin("tool_search")]
    )
    full = [_openai("bash_exec"), _openai("web_fetch"), _openai("tool_search")]
    ctx = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="auto"),
        catalog=catalog,
        state=ToolSearchStateV1(),
        tool_search_allowed=True,
        effective_threshold=50_000,
        apply_threshold=6000,
        resolved_applied=None,
    )
    # Tiny 3-tool pool is below the 6000 apply gate, so projection fail-opens.
    out = project_tools_for_round(ctx, full_openai_tools=full)
    assert out is full


def test_resolve_effective_threshold_manual():
    cfg = ToolSearchConfig(
        mode="auto",
        threshold_strategy="manual",
        auto_schema_token_threshold=1000,
    )
    assert resolve_effective_threshold(cfg, context_window=200_000) == 1000


def test_config_normalized_clamps_ratio_and_strategy():
    assert ToolSearchConfig(mode="auto", context_budget_ratio=0.9).normalized().context_budget_ratio == 0.25
    assert (
        ToolSearchConfig(mode="auto", threshold_strategy="bogus").normalized().threshold_strategy
        == "adaptive"
    )


def test_decide_apply_with_hysteresis_band():
    assert decide_apply_with_hysteresis(prev_applied=None, pool_tokens=6400, threshold=6400) is True
    assert decide_apply_with_hysteresis(prev_applied=True, pool_tokens=5200, threshold=6400) is True
    assert decide_apply_with_hysteresis(prev_applied=True, pool_tokens=5119, threshold=6400) is False
    assert decide_apply_with_hysteresis(prev_applied=False, pool_tokens=7000, threshold=6400) is False
    assert decide_apply_with_hysteresis(prev_applied=False, pool_tokens=7680, threshold=6400) is True


def test_resolved_applied_single_source_for_project_and_pending():
    catalog = build_catalog([_builtin("bash_exec"), _builtin("web_fetch"), _builtin("tool_search")])
    full = [_openai("bash_exec"), _openai("web_fetch"), _openai("tool_search")]
    ctx_off = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="always"),
        catalog=catalog,
        state=ToolSearchStateV1(),
        tool_search_allowed=True,
        resolved_applied=False,
    )
    out = project_tools_for_round(ctx_off, full_openai_tools=full)
    assert out is full
    assert (
        is_tool_pending_next_round(
            ctx_off,
            "web_fetch",
            allowed_tool_names={"bash_exec", "tool_search"},
            full_openai_tools=full,
        )
        is False
    )

    ctx_on = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="always"),
        catalog=catalog,
        state=ToolSearchStateV1(),
        tool_search_allowed=True,
        resolved_applied=True,
    )
    projected = project_tools_for_round(ctx_on, full_openai_tools=full)
    names = {
        str((t.get("function") or {}).get("name") or "")
        for t in projected
        if isinstance(t, dict)
    }
    assert "web_fetch" not in names
    assert (
        is_tool_pending_next_round(
            ctx_on,
            "web_fetch",
            allowed_tool_names=names,
            full_openai_tools=full,
        )
        is True
    )


def test_resolve_max_loaded_bounds():
    assert resolve_max_loaded(effective_threshold=50_000, core_schema_tokens=5_000) == 24
    assert resolve_max_loaded(effective_threshold=6_400, core_schema_tokens=5_777) == 8
