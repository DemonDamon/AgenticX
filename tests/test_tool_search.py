"""Unit tests for agenticx.runtime.tool_search (SP1 core contract)."""

from __future__ import annotations

import json

from agenticx.runtime.tool_search import (
    BUILTIN_DEFER_ALLOWLIST,
    CORE_ALWAYS_LOAD_TOOLS,
    TOOL_SEARCH_MAX_LOADED,
    TOOL_SEARCH_STATE_KEY,
    TOOL_SEARCH_TOOL_NAME,
    ToolCatalog,
    ToolDescriptor,
    ToolSearchConfig,
    ToolSearchRuntimeContext,
    ToolSearchStateV1,
    apply_search,
    build_catalog,
    catalog_fingerprint,
    dump_state_to_scratchpad,
    estimate_schema_tokens,
    load_state_from_scratchpad,
    make_mcp_public_name,
    mark_loaded,
    project_tools_for_round,
    prune_state_to_catalog,
    rank_tools,
    should_apply_tool_search,
    slugify_mcp_segment,
)


def _builtin(name: str, *, desc: str = "", hints: tuple[str, ...] = ()) -> ToolDescriptor:
    return ToolDescriptor(
        stable_id=f"builtin:{name}",
        name=name,
        kind="builtin",
        description=desc or f"Builtin {name}",
        input_schema={"type": "object", "properties": {}},
        search_hints=hints,
    )


def _mcp(
    server: str,
    tool: str,
    *,
    public: str | None = None,
    desc: str = "",
    routed: str | None = None,
) -> ToolDescriptor:
    existing: set[str] = set()
    name = public or make_mcp_public_name(server, tool, existing=existing)
    return ToolDescriptor(
        stable_id=f"mcp:{slugify_mcp_segment(server)}:{slugify_mcp_segment(tool)}",
        name=name,
        kind="mcp",
        description=desc or f"{server} {tool}",
        input_schema={
            "type": "object",
            "properties": {"q": {"type": "string"}},
            "required": ["q"],
        },
        server_slug=slugify_mcp_segment(server),
        original_mcp_name=routed or tool,
        search_hints=(server, tool),
    )


def _openai(name: str, *, desc: str = "d") -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def test_select_exact_name():
    catalog = build_catalog(
        [
            _builtin("web_fetch", desc="fetch urls"),
            _builtin("web_search", desc="search web"),
            _mcp("photos", "search", desc="search photos"),
        ]
    )
    hits = rank_tools("select:web_fetch", catalog, max_results=5)
    assert len(hits) == 1
    assert hits[0].name == "web_fetch"


def test_plus_required_filters():
    catalog = build_catalog(
        [
            _builtin("web_fetch", desc="http fetch helper"),
            _builtin("web_search", desc="search the internet"),
            _builtin("liteparse", desc="parse documents"),
        ]
    )
    hits = rank_tools("+fetch web", catalog, max_results=10)
    names = [h.name for h in hits]
    assert "web_fetch" in names
    assert "web_search" not in names


def test_rank_stable_tiebreak():
    a = _builtin("aaa_tool", desc="shared token widget")
    b = _builtin("bbb_tool", desc="shared token widget")
    catalog = build_catalog([b, a])
    hits = rank_tools("widget", catalog, max_results=10)
    assert [h.name for h in hits] == ["aaa_tool", "bbb_tool"]


def test_mcp_public_name_collision_and_64():
    existing: set[str] = set()
    long_tool = "search_albums_very_long_name_that_exceeds_limit_abcdef"
    n1 = make_mcp_public_name("photos", long_tool, existing=existing)
    assert len(n1) <= 64
    assert n1.startswith("mcp__")
    existing.add(n1)
    n2 = make_mcp_public_name("photos", long_tool, existing=existing)
    assert n2 != n1
    assert len(n2) <= 64
    # Deterministic for same inputs + existing
    existing2 = {n1}
    n2b = make_mcp_public_name("photos", long_tool, existing=existing2)
    assert n2b == n2
    assert slugify_mcp_segment("Photo Server!") == "photo_server"


def test_lru_evicts_oldest():
    state = ToolSearchStateV1(loaded_ids=[], catalog_fingerprint="fp")
    ids = [f"builtin:t{i}" for i in range(TOOL_SEARCH_MAX_LOADED + 3)]
    state = mark_loaded(state, ids)
    assert len(state.loaded_ids) == TOOL_SEARCH_MAX_LOADED
    assert state.loaded_ids[0] == "builtin:t3"
    assert state.loaded_ids[-1] == ids[-1]
    # touch oldest remaining → moves to end
    state = mark_loaded(state, [state.loaded_ids[0]])
    assert state.loaded_ids[-1] == "builtin:t3"


def test_fingerprint_change_prunes_stale():
    d1 = _builtin("web_fetch")
    d2 = _builtin("web_search")
    cat1 = build_catalog([d1, d2])
    state = ToolSearchStateV1(
        loaded_ids=["builtin:web_fetch", "builtin:gone"],
        catalog_fingerprint="old",
    )
    pruned = prune_state_to_catalog(state, cat1)
    assert pruned.loaded_ids == ["builtin:web_fetch"]
    assert pruned.catalog_fingerprint == cat1.fingerprint
    assert catalog_fingerprint(cat1.descriptors) == cat1.fingerprint


def test_mode_off_returns_full_pool():
    catalog = build_catalog([_builtin("web_fetch"), _builtin(TOOL_SEARCH_TOOL_NAME)])
    full = [_openai("web_fetch"), _openai(TOOL_SEARCH_TOOL_NAME), _openai("bash_exec")]
    ctx = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="off"),
        catalog=catalog,
        state=ToolSearchStateV1(),
        tool_search_allowed=True,
    )
    out = project_tools_for_round(ctx, full_openai_tools=full)
    assert out is full
    assert not should_apply_tool_search(
        ToolSearchConfig(mode="off"),
        full_pool_schema_tokens=99_999,
        tool_search_allowed=True,
    )


def test_mode_auto_threshold():
    assert should_apply_tool_search(
        ToolSearchConfig(mode="auto", auto_schema_token_threshold=6000),
        full_pool_schema_tokens=6000,
        tool_search_allowed=True,
    )
    assert not should_apply_tool_search(
        ToolSearchConfig(mode="auto", auto_schema_token_threshold=6000),
        full_pool_schema_tokens=5999,
        tool_search_allowed=True,
    )
    assert should_apply_tool_search(
        ToolSearchConfig(mode="always"),
        full_pool_schema_tokens=1,
        tool_search_allowed=True,
    )


def test_fail_open_when_tool_search_disallowed():
    full = [_openai("web_fetch"), _openai("bash_exec")]
    ctx = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="always"),
        catalog=build_catalog([_builtin("web_fetch")]),
        state=ToolSearchStateV1(),
        tool_search_allowed=False,
    )
    out = project_tools_for_round(ctx, full_openai_tools=full)
    assert out is full
    assert not should_apply_tool_search(
        ToolSearchConfig(mode="always"),
        full_pool_schema_tokens=99_999,
        tool_search_allowed=False,
    )


def test_project_omits_deferred_until_loaded():
    assert "web_fetch" in BUILTIN_DEFER_ALLOWLIST
    assert "bash_exec" in CORE_ALWAYS_LOAD_TOOLS
    catalog = build_catalog(
        [
            _builtin("web_fetch"),
            _builtin("bash_exec"),
            _builtin(TOOL_SEARCH_TOOL_NAME),
            _mcp("photos", "search"),
        ]
    )
    full = [
        _openai("web_fetch"),
        _openai("bash_exec"),
        _openai(TOOL_SEARCH_TOOL_NAME),
        _openai("file_read"),
    ]
    ctx = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="always"),
        catalog=catalog,
        state=ToolSearchStateV1(catalog_fingerprint=catalog.fingerprint),
        tool_search_allowed=True,
    )
    round0 = project_tools_for_round(ctx, full_openai_tools=full)
    names0 = {_openai_name(t) for t in round0}
    assert "bash_exec" in names0
    assert TOOL_SEARCH_TOOL_NAME in names0
    assert "web_fetch" not in names0
    assert not any(n.startswith("mcp__photos__") for n in names0)

    ctx2, result = apply_search(ctx, "select:web_fetch", max_results=5)
    assert result["matches"][0]["name"] == "web_fetch"
    round1 = project_tools_for_round(ctx2, full_openai_tools=full)
    names1 = {_openai_name(t) for t in round1}
    assert "web_fetch" in names1


def test_apply_search_result_has_no_full_schema():
    catalog = build_catalog([_mcp("photos", "search", desc="album search")])
    ctx = ToolSearchRuntimeContext(
        config=ToolSearchConfig(mode="always"),
        catalog=catalog,
        state=ToolSearchStateV1(catalog_fingerprint=catalog.fingerprint),
        tool_search_allowed=True,
    )
    _, result = apply_search(ctx, "photos album", max_results=5)
    blob = json.dumps(result)
    assert "input_schema" not in blob
    assert "properties" not in blob
    assert "matches" in result
    assert "note" in result


def test_estimate_and_fingerprint_stable():
    tools = [_openai("a"), _openai("b")]
    t1 = estimate_schema_tokens(tools)
    t2 = estimate_schema_tokens(tools)
    assert t1 == t2
    assert t1 > 0
    descs = [_builtin("a"), _builtin("b")]
    assert catalog_fingerprint(descs) == catalog_fingerprint(list(reversed(descs)))


def test_scratchpad_roundtrip():
    scratch: dict = {}
    state = ToolSearchStateV1(loaded_ids=["builtin:web_fetch"], catalog_fingerprint="abc")
    dump_state_to_scratchpad(scratch, state)
    assert TOOL_SEARCH_STATE_KEY in scratch
    loaded = load_state_from_scratchpad(scratch)
    assert loaded.loaded_ids == ["builtin:web_fetch"]
    assert loaded.catalog_fingerprint == "abc"
    assert load_state_from_scratchpad({"__tool_search_state_v1__": "bad"}).loaded_ids == []


def _openai_name(tool: dict) -> str:
    return str((tool.get("function") or {}).get("name") or "")
