"""Runtime helpers for ToolSearch: config load and context assembly."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from agenticx.runtime.tool_search import (
    BUILTIN_DEFER_ALLOWLIST,
    CORE_ALWAYS_LOAD_TOOLS,
    DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD,
    TOOL_SEARCH_TOOL_NAME,
    ToolCatalog,
    ToolDescriptor,
    ToolSearchConfig,
    ToolSearchRuntimeContext,
    ToolSearchStateV1,
    build_catalog,
    load_state_from_scratchpad,
    prune_state_to_catalog,
)


def read_tool_search_config() -> ToolSearchConfig:
    """Read ``runtime.tool_search`` from merged config; default mode=off."""
    mode = "off"
    threshold = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager.get_value("runtime.tool_search")
        if isinstance(raw, dict):
            mode = str(raw.get("mode") or "off").strip().lower() or "off"
            try:
                threshold = int(
                    raw.get("auto_schema_token_threshold")
                    or DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
                )
            except (TypeError, ValueError):
                threshold = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
        # Flat legacy keys (read-only compat)
        flat_mode = ConfigManager.get_value("runtime.tool_search_mode")
        if isinstance(flat_mode, str) and flat_mode.strip() and not isinstance(raw, dict):
            mode = flat_mode.strip().lower()
    except Exception:
        pass
    return ToolSearchConfig(mode=mode, auto_schema_token_threshold=threshold).normalized()


def _openai_tool_name(tool: dict) -> str:
    if not isinstance(tool, dict):
        return ""
    fn = tool.get("function")
    if not isinstance(fn, dict):
        return ""
    return str(fn.get("name") or "").strip()


def build_builtin_catalog(openai_tools: list[dict]) -> ToolCatalog:
    """Wrap policy-filtered OpenAI tools into builtin ToolDescriptors."""
    descriptors: List[ToolDescriptor] = []
    seen: set[str] = set()
    for tool in openai_tools:
        name = _openai_tool_name(tool)
        if not name or name in seen:
            continue
        seen.add(name)
        fn = tool.get("function") if isinstance(tool, dict) else {}
        if not isinstance(fn, dict):
            fn = {}
        desc = str(fn.get("description") or "")
        params = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else {}
        always = name in CORE_ALWAYS_LOAD_TOOLS or name not in BUILTIN_DEFER_ALLOWLIST
        descriptors.append(
            ToolDescriptor(
                stable_id=f"builtin:{name}",
                name=name,
                kind="builtin",
                description=desc,
                input_schema=dict(params),
                always_load=always,
            )
        )
    return build_catalog(descriptors)


def build_runtime_context(
    *,
    session: Any,
    full_openai_tools: list[dict],
    mcp_descriptors: Sequence[ToolDescriptor] = (),
    config: Optional[ToolSearchConfig] = None,
) -> ToolSearchRuntimeContext:
    """Merge builtin + mcp descriptors; load/prune scratchpad state."""
    cfg = config or read_tool_search_config()
    builtin_cat = build_builtin_catalog(list(full_openai_tools))
    merged: List[ToolDescriptor] = list(builtin_cat.descriptors)
    seen_ids = {d.stable_id for d in merged}
    for d in mcp_descriptors:
        if d.stable_id in seen_ids:
            continue
        seen_ids.add(d.stable_id)
        merged.append(d)
    catalog = build_catalog(merged)

    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        scratchpad = {}
        try:
            setattr(session, "scratchpad", scratchpad)
        except Exception:
            pass
    state = load_state_from_scratchpad(scratchpad)
    state = prune_state_to_catalog(state, catalog)

    pool_names = {_openai_tool_name(t) for t in full_openai_tools}
    tool_search_allowed = TOOL_SEARCH_TOOL_NAME in pool_names

    return ToolSearchRuntimeContext(
        config=cfg,
        catalog=catalog,
        state=state,
        tool_search_allowed=tool_search_allowed,
    )


def empty_state() -> ToolSearchStateV1:
    return ToolSearchStateV1()
