"""Provider-agnostic ToolSearch: catalog, ranking, state, and projection.

Pure functions only — no AgentRuntime / MCPHub / Desktop imports.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

TOOL_SEARCH_STATE_KEY = "__tool_search_state_v1__"
TOOL_SEARCH_TOOL_NAME = "tool_search"
TOOL_SEARCH_MAX_LOADED = 24
TOOL_SEARCH_MIN_LOADED = 8
DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD = 6000
TOOL_NOT_YET_LOADED_TEMPLATE = (
    "Tool '{name}' schema is not loaded yet. "
    "Call tool_search and retry on the next round."
)
TOOL_AUTO_LOADED_TEMPLATE = (
    "Tool '{name}' schema was not loaded and has been auto-loaded. "
    "Retry the same call directly on the next round; do NOT call tool_search first."
)
DEFAULT_CONTEXT_BUDGET_RATIO = 0.05
CONTEXT_BUDGET_RATIO_MIN = 0.01
CONTEXT_BUDGET_RATIO_MAX = 0.25
THRESHOLD_FLOOR = 1000
THRESHOLD_CEIL = 50000
HYSTERESIS_RATIO = 0.2
TOOL_SEARCH_DECISION_KEY = "__tool_search_decision_v1__"
_VALID_STRATEGIES = frozenset({"adaptive", "manual"})

CORE_ALWAYS_LOAD_TOOLS: frozenset[str] = frozenset(
    {
        "request_clarification",
        "request_action_confirmation",
        "bash_exec",
        "bash_bg_start",
        "bash_bg_poll",
        "bash_bg_input",
        "bash_bg_stop",
        "file_read",
        "file_write",
        "file_edit",
        "list_files",
        "code_outline",
        "todo_write",
        "mcp_connect",
        "mcp_call",
        "list_mcps",
        "skill_use",
        "memory_search",
        "knowledge_search",
        "spawn_subagent",
        "delegate_to_avatar",
        "query_subagent_status",
        "send_message_to_agent",
        "cancel_subagent",
        "retry_subagent",
        "set_taskspace",
        "tool_search",
    }
)

# 历史遗留的"可延迟工具"名单。**它已经不再是判定闸门**，只作为参考保留（并且
# 仍被若干测试引用）。
#
# 原来的规则是「不在这张表里的内建工具一律常驻」——也就是默认常驻、按名单开洞。
# 这种名单会腐烂：任何人新加一个工具，只要忘了往表里加一行，它就自动变成常驻，
# 谁也不会发现。实测今天正好有 10 个工具从这条缝里漏成常驻，白占 1969 token：
# analyze_image / feature_complete / feature_select / get_current_datetime /
# progress_append / project_init / project_status / show_widget /
# skill_market_install / verify_run。
#
# 现在反过来：唯一的常驻集合是 CORE_ALWAYS_LOAD_TOOLS，其余内建工具一律可延迟
# （见 is_deferred_builtin）。新增工具默认省 token，要常驻必须显式写进 CORE。
BUILTIN_DEFER_ALLOWLIST: frozenset[str] = frozenset(
    {
        "cancel_scheduled_task",
        "cc_bridge_list",
        "cc_bridge_permission",
        "cc_bridge_send",
        "cc_bridge_start",
        "cc_bridge_stop",
        "chat_with_avatar",
        "check_resources",
        "code_index_cancel",
        "code_index_clear",
        "code_index_create",
        "code_index_status",
        "code_search",
        "codegen",
        "create_avatar",
        "desktop_keyboard_type",
        "desktop_mouse_click",
        "desktop_screenshot",
        "get_automation_task_logs",
        "hook_manage",
        "knowledge_synthesize",
        "list_data_sources",
        "list_scheduled_tasks",
        "list_skills",
        "liteparse",
        "lsp_diagnostics",
        "lsp_find_references",
        "lsp_goto_definition",
        "lsp_hover",
        "mcp_import",
        "memory_append",
        "memory_forget",
        "query_data_source",
        "read_avatar_workspace",
        "recommend_subagent_model",
        "schedule_task",
        "scratchpad_read",
        "scratchpad_write",
        "send_bug_report_email",
        "session_search",
        "skill_import_repo",
        "skill_list",
        "skill_manage",
        "task_experience_clear",
        "task_experience_learn",
        "task_experience_retrieve",
        "update_email_config",
        "update_scheduled_task",
        "video_understand",
        "view_image",
        "web_fetch",
        "web_search",
    }
)

_SLUG_RE = re.compile(r"[^a-zA-Z0-9_-]+")
_VALID_MODES = frozenset({"off", "auto", "always"})


@dataclass(frozen=True)
class ToolDescriptor:
    stable_id: str
    name: str
    kind: str  # "builtin" | "mcp"
    description: str
    input_schema: dict
    search_hints: tuple[str, ...] = ()
    server_slug: Optional[str] = None
    original_mcp_name: Optional[str] = None
    always_load: bool = False


@dataclass(frozen=True)
class ToolSearchConfig:
    mode: str = "auto"  # "off" | "auto" | "always"
    auto_schema_token_threshold: int = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
    threshold_strategy: str = "adaptive"
    context_budget_ratio: float = DEFAULT_CONTEXT_BUDGET_RATIO

    def normalized(self) -> "ToolSearchConfig":
        mode = (self.mode or "off").strip().lower()
        if mode not in _VALID_MODES:
            mode = "off"
        threshold = int(self.auto_schema_token_threshold or DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD)
        if threshold < 1:
            threshold = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
        strategy = (self.threshold_strategy or "adaptive").strip().lower()
        if strategy not in _VALID_STRATEGIES:
            strategy = "adaptive"
        try:
            ratio = float(self.context_budget_ratio)
        except (TypeError, ValueError):
            ratio = DEFAULT_CONTEXT_BUDGET_RATIO
        if ratio != ratio:  # NaN
            ratio = DEFAULT_CONTEXT_BUDGET_RATIO
        ratio = max(CONTEXT_BUDGET_RATIO_MIN, min(CONTEXT_BUDGET_RATIO_MAX, ratio))
        return ToolSearchConfig(
            mode=mode,
            auto_schema_token_threshold=threshold,
            threshold_strategy=strategy,
            context_budget_ratio=ratio,
        )


@dataclass
class ToolSearchStateV1:
    loaded_ids: list[str] = field(default_factory=list)
    catalog_fingerprint: str = ""
    version: int = 1


@dataclass(frozen=True)
class ToolCatalog:
    descriptors: tuple[ToolDescriptor, ...]
    fingerprint: str


@dataclass
class ToolSearchRuntimeContext:
    config: ToolSearchConfig
    catalog: ToolCatalog
    state: ToolSearchStateV1
    tool_search_allowed: bool
    effective_threshold: Optional[int] = None
    prev_applied: Optional[bool] = None
    resolved_applied: Optional[bool] = None


def slugify_mcp_segment(raw: str) -> str:
    """Normalize to [a-zA-Z0-9_-]; collapse runs; prefer lower-case."""
    text = (raw or "").strip().lower()
    text = _SLUG_RE.sub("_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "x"


def _stable_short_hash(*parts: str) -> str:
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return h[:6]


def make_mcp_public_name(server: str, tool: str, *, existing: set[str]) -> str:
    """Build ``mcp__{server}__{tool}``; truncate/hash on length or collision."""
    server_slug = slugify_mcp_segment(server)
    tool_slug = slugify_mcp_segment(tool)
    base = f"mcp__{server_slug}__{tool_slug}"
    if len(base) <= 64 and base not in existing:
        return base

    digest = _stable_short_hash(server_slug, tool_slug)
    # Reserve room for '_' + 6-char hash
    max_stem = 64 - 1 - len(digest)
    stem = base[:max_stem].rstrip("_")
    candidate = f"{stem}_{digest}"
    if candidate not in existing:
        return candidate

    # Collision on truncated form: bump with extra hash material
    n = 2
    while True:
        digest_n = _stable_short_hash(server_slug, tool_slug, str(n))
        max_stem_n = 64 - 1 - len(digest_n)
        stem_n = base[:max_stem_n].rstrip("_")
        candidate_n = f"{stem_n}_{digest_n}"
        if candidate_n not in existing:
            return candidate_n
        n += 1


def estimate_schema_tokens(tools: list[dict]) -> int:
    """Rough token estimate from serialized OpenAI tool schemas."""
    payload = json.dumps(tools, ensure_ascii=False, separators=(",", ":"))
    return int(len(payload) / 3.5)


def _canonical_schema_json(schema: dict) -> str:
    return json.dumps(schema or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def catalog_fingerprint(descriptors: Sequence[ToolDescriptor]) -> str:
    """SHA256 over sorted descriptor identity fields."""
    lines: List[str] = []
    for d in sorted(descriptors, key=lambda x: x.stable_id):
        lines.append(
            "|".join(
                [
                    d.stable_id,
                    d.name,
                    d.description or "",
                    _canonical_schema_json(d.input_schema),
                ]
            )
        )
    blob = "\n".join(lines).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def build_catalog(descriptors: Sequence[ToolDescriptor]) -> ToolCatalog:
    tup = tuple(descriptors)
    return ToolCatalog(descriptors=tup, fingerprint=catalog_fingerprint(tup))


def load_state_from_scratchpad(scratchpad: Optional[dict]) -> ToolSearchStateV1:
    if not isinstance(scratchpad, dict):
        return ToolSearchStateV1()
    raw = scratchpad.get(TOOL_SEARCH_STATE_KEY)
    if not isinstance(raw, dict):
        return ToolSearchStateV1()
    loaded = raw.get("loaded_ids")
    if not isinstance(loaded, list):
        loaded_ids: list[str] = []
    else:
        loaded_ids = [str(x) for x in loaded if isinstance(x, (str, int))]
    fp = str(raw.get("catalog_fingerprint") or "")
    try:
        version = int(raw.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    return ToolSearchStateV1(loaded_ids=loaded_ids, catalog_fingerprint=fp, version=version)


def dump_state_to_scratchpad(scratchpad: dict, state: ToolSearchStateV1) -> None:
    scratchpad[TOOL_SEARCH_STATE_KEY] = {
        "version": int(state.version or 1),
        "loaded_ids": list(state.loaded_ids),
        "catalog_fingerprint": str(state.catalog_fingerprint or ""),
    }


def prune_state_to_catalog(state: ToolSearchStateV1, catalog: ToolCatalog) -> ToolSearchStateV1:
    valid = {d.stable_id for d in catalog.descriptors}
    kept = [sid for sid in state.loaded_ids if sid in valid]
    return ToolSearchStateV1(
        loaded_ids=kept,
        catalog_fingerprint=catalog.fingerprint,
        version=state.version,
    )


def mark_loaded(
    state: ToolSearchStateV1,
    ids: Sequence[str],
    *,
    max_loaded: Optional[int] = None,
) -> ToolSearchStateV1:
    """Append/touch ids (LRU: most recent at end); evict oldest beyond max."""
    limit = TOOL_SEARCH_MAX_LOADED if max_loaded is None else int(max_loaded)
    if limit < 1:
        limit = TOOL_SEARCH_MAX_LOADED
    loaded = [sid for sid in state.loaded_ids if sid]
    for sid in ids:
        sid_s = str(sid or "").strip()
        if not sid_s:
            continue
        if sid_s in loaded:
            loaded.remove(sid_s)
        loaded.append(sid_s)
    while len(loaded) > limit:
        loaded.pop(0)
    return ToolSearchStateV1(
        loaded_ids=loaded,
        catalog_fingerprint=state.catalog_fingerprint,
        version=state.version,
    )


def resolve_effective_threshold(
    config: ToolSearchConfig,
    *,
    context_window: int,
) -> int:
    """Absolute schema-token threshold for the current model."""
    cfg = config.normalized()
    if cfg.threshold_strategy == "manual":
        return int(cfg.auto_schema_token_threshold)
    window = int(context_window) if int(context_window) > 0 else 128_000
    raw = int(window * cfg.context_budget_ratio)
    return max(THRESHOLD_FLOOR, min(THRESHOLD_CEIL, raw))


def decide_apply_with_hysteresis(
    *,
    prev_applied: Optional[bool],
    pool_tokens: int,
    threshold: int,
    hysteresis_ratio: float = HYSTERESIS_RATIO,
) -> bool:
    """Latch the previous decision unless the pool moves clear of the band."""
    tokens = int(pool_tokens)
    thr = int(threshold)
    if prev_applied is None:
        return tokens >= thr
    if prev_applied:
        return tokens >= int(thr * (1.0 - hysteresis_ratio))
    return tokens >= int(thr * (1.0 + hysteresis_ratio))


def resolve_max_loaded(*, effective_threshold: int, core_schema_tokens: int) -> int:
    """How many deferred tools may stay hot, given the remaining budget."""
    remaining = max(0, int(effective_threshold) - int(core_schema_tokens))
    # ~350 tokens is a rough per-tool schema cost in this codebase.
    est = remaining // 350
    return max(TOOL_SEARCH_MIN_LOADED, min(TOOL_SEARCH_MAX_LOADED, est))


def should_apply_tool_search(
    config: ToolSearchConfig,
    *,
    full_pool_schema_tokens: int,
    tool_search_allowed: bool,
    effective_threshold: Optional[int] = None,
    prev_applied: Optional[bool] = None,
) -> bool:
    """Return whether projection should shrink the tool surface.

    Fail-open: when ``tool_search_allowed`` is False, return False so the
    caller keeps today's full builtin tool pool.
    """
    if not tool_search_allowed:
        return False
    cfg = config.normalized()
    if cfg.mode == "off":
        return False
    if cfg.mode == "always":
        return True
    thr = (
        int(effective_threshold)
        if effective_threshold is not None
        else int(cfg.auto_schema_token_threshold)
    )
    return decide_apply_with_hysteresis(
        prev_applied=prev_applied,
        pool_tokens=int(full_pool_schema_tokens),
        threshold=thr,
    )


def _resolve_applied(ctx: ToolSearchRuntimeContext, full_openai_tools: list[dict]) -> bool:
    if ctx.resolved_applied is not None:
        return bool(ctx.resolved_applied)
    return should_apply_tool_search(
        ctx.config,
        full_pool_schema_tokens=estimate_schema_tokens(list(full_openai_tools)),
        tool_search_allowed=ctx.tool_search_allowed,
        effective_threshold=ctx.effective_threshold,
        prev_applied=ctx.prev_applied,
    )


def _estimate_core_schema_tokens(ctx: ToolSearchRuntimeContext) -> int:
    """Estimate schema tokens for always-load / non-deferred catalog tools."""
    core_tools: List[dict] = []
    for d in ctx.catalog.descriptors:
        if d.always_load or d.name in CORE_ALWAYS_LOAD_TOOLS:
            core_tools.append(_descriptor_to_openai_tool(d))
            continue
        if d.kind == "builtin" and not is_deferred_builtin(d.name):
            core_tools.append(_descriptor_to_openai_tool(d))
    return estimate_schema_tokens(core_tools)


def _openai_tool_name(tool: dict) -> str:
    if not isinstance(tool, dict):
        return ""
    fn = tool.get("function")
    if not isinstance(fn, dict):
        return ""
    return str(fn.get("name") or "").strip()


def _descriptor_to_openai_tool(d: ToolDescriptor) -> dict:
    return {
        "type": "function",
        "function": {
            "name": d.name,
            "description": d.description or "",
            "parameters": d.input_schema if isinstance(d.input_schema, dict) else {},
        },
    }


def _pool_by_name(full_openai_tools: list[dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for tool in full_openai_tools:
        name = _openai_tool_name(tool)
        if name and name not in out:
            out[name] = tool
    return out


def project_tools_for_round(
    ctx: ToolSearchRuntimeContext,
    *,
    full_openai_tools: list[dict],
) -> list[dict]:
    """Project the OpenAI ``tools[]`` list for the current model round.

    When ToolSearch is not applied (mode off / auto under threshold /
    ``tool_search`` disallowed), returns ``full_openai_tools`` unchanged
    (fail-open to today's full surface).
    """
    if not _resolve_applied(ctx, full_openai_tools):
        return full_openai_tools

    pool = _pool_by_name(full_openai_tools)
    loaded_ids = set(ctx.state.loaded_ids)
    by_stable = {d.stable_id: d for d in ctx.catalog.descriptors}
    by_name = {d.name: d for d in ctx.catalog.descriptors}

    selected_names: List[str] = []
    seen: set[str] = set()

    def _add_name(name: str) -> None:
        if not name or name in seen:
            return
        seen.add(name)
        selected_names.append(name)

    # Core always-load ∩ pool
    for name in sorted(CORE_ALWAYS_LOAD_TOOLS):
        if name in pool:
            _add_name(name)

    # Non-deferred builtins that are not in CORE: still always-load
    for name, tool in pool.items():
        if name in CORE_ALWAYS_LOAD_TOOLS:
            continue
        if is_deferred_builtin(name):
            continue
        _add_name(name)

    # Always include tool_search if present in pool
    if TOOL_SEARCH_TOOL_NAME in pool:
        _add_name(TOOL_SEARCH_TOOL_NAME)

    # Loaded descriptors (builtin from pool, mcp synthesized)
    for sid in ctx.state.loaded_ids:
        d = by_stable.get(sid)
        if d is None:
            continue
        if d.kind == "builtin":
            if d.name in pool:
                _add_name(d.name)
        elif d.kind == "mcp":
            _add_name(d.name)

    result: list[dict] = []
    for name in selected_names:
        if name in pool:
            result.append(pool[name])
            continue
        d = by_name.get(name)
        if d is not None and d.kind == "mcp":
            result.append(_descriptor_to_openai_tool(d))
    # silence unused warning for loaded_ids in some linters
    _ = loaded_ids
    return result


def _tokenize_query(query: str) -> Tuple[List[str], List[str], Optional[str]]:
    """Return (required_tokens, free_tokens, select_name)."""
    q = (query or "").strip()
    select_name: Optional[str] = None
    if q.lower().startswith("select:"):
        select_name = q.split(":", 1)[1].strip()
        return [], [], select_name

    required: List[str] = []
    free: List[str] = []
    for tok in re.split(r"\s+", q):
        if not tok:
            continue
        if tok.startswith("+") and len(tok) > 1:
            required.append(tok[1:].lower())
        else:
            free.append(tok.lower())
    return required, free, None


def _haystack(d: ToolDescriptor) -> Tuple[str, str, str]:
    name = (d.name or "").lower()
    hints = " ".join(d.search_hints).lower()
    desc = (d.description or "").lower()
    return name, hints, desc


def rank_tools(
    query: str,
    catalog: ToolCatalog,
    *,
    max_results: int = 5,
) -> list[ToolDescriptor]:
    """Deterministic weighted ranking. No embeddings / randomness."""
    max_results = max(1, min(20, int(max_results or 5)))
    required, free, select_name = _tokenize_query(query)
    q_raw = (query or "").strip()
    q_lower = q_raw.lower()

    if select_name:
        exact = [d for d in catalog.descriptors if d.name == select_name]
        if exact:
            return exact[:1]
        # fall through with select_name as free token
        free = [select_name.lower()]

    # Exact name match on full query
    exact_full = [d for d in catalog.descriptors if d.name == q_raw]
    if exact_full and not required:
        return exact_full[:1]

    prefer_server: Optional[str] = None
    if q_lower.startswith("mcp__"):
        parts = q_lower.split("__")
        if len(parts) >= 2 and parts[1]:
            prefer_server = parts[1]
    else:
        # bare server slug prefix hint
        first = free[0] if free else ""
        if first and not first.startswith("+"):
            for d in catalog.descriptors:
                if d.kind == "mcp" and d.server_slug and d.server_slug == first:
                    prefer_server = first
                    break

    scored: List[Tuple[int, str, ToolDescriptor]] = []
    for d in catalog.descriptors:
        name, hints, desc = _haystack(d)
        blob = f"{name} {hints} {desc}"

        if required:
            if any(tok not in blob for tok in required):
                continue

        score = 0
        if d.name == q_raw:
            score += 10_000
        if prefer_server and d.server_slug == prefer_server:
            score += 500
        if prefer_server and d.name.lower().startswith(f"mcp__{prefer_server}__"):
            score += 400

        for tok in free:
            if not tok:
                continue
            if tok in name or name.startswith(tok) or f"_{tok}" in name:
                score += 100
            elif tok in hints:
                score += 40
            elif tok in desc:
                score += 10

        for tok in required:
            if tok in name:
                score += 80
            elif tok in hints:
                score += 30
            elif tok in desc:
                score += 8

        if score <= 0 and not required:
            continue
        if score <= 0 and required:
            # required matched (else continue above) — give base score
            score = 1
        scored.append((score, d.stable_id, d))

    scored.sort(key=lambda x: (-x[0], x[1]))
    return [d for _, _, d in scored[:max_results]]


def apply_search(
    ctx: ToolSearchRuntimeContext,
    query: str,
    *,
    max_results: int = 5,
) -> Tuple[ToolSearchRuntimeContext, dict]:
    """Rank tools, mark loaded, return compact result (no full schemas)."""
    matches = rank_tools(query, ctx.catalog, max_results=max_results)
    ids = [d.stable_id for d in matches]
    thr = (
        int(ctx.effective_threshold)
        if ctx.effective_threshold is not None
        else int(ctx.config.normalized().auto_schema_token_threshold)
    )
    max_loaded = resolve_max_loaded(
        effective_threshold=thr,
        core_schema_tokens=_estimate_core_schema_tokens(ctx),
    )
    new_state = mark_loaded(ctx.state, ids, max_loaded=max_loaded)
    new_state = ToolSearchStateV1(
        loaded_ids=new_state.loaded_ids,
        catalog_fingerprint=ctx.catalog.fingerprint,
        version=new_state.version,
    )
    new_ctx = ToolSearchRuntimeContext(
        config=ctx.config,
        catalog=ctx.catalog,
        state=new_state,
        tool_search_allowed=ctx.tool_search_allowed,
        effective_threshold=ctx.effective_threshold,
        prev_applied=ctx.prev_applied,
        resolved_applied=ctx.resolved_applied,
    )
    result = {
        "matches": [
            {
                "name": d.name,
                "stable_id": d.stable_id,
                "description": d.description or "",
            }
            for d in matches
        ],
        "loaded_names": [
            next((d.name for d in ctx.catalog.descriptors if d.stable_id == sid), sid)
            for sid in new_state.loaded_ids
        ],
        "note": "Schemas will be available on the next model round.",
    }
    return new_ctx, result


def is_deferred_builtin(name: str) -> bool:
    """判定闸门：内建工具只要不在 CORE_ALWAYS_LOAD_TOOLS 里就可以延迟加载。

    这是全模块唯一的延迟判定，投影、预算估算、待加载检测和清单渲染都走它，
    免得四处各写一遍 ``in BUILTIN_DEFER_ALLOWLIST`` 再慢慢漂移。
    """
    return name not in CORE_ALWAYS_LOAD_TOOLS


def auto_load_deferred_tool(session: Any, ts_ctx: ToolSearchRuntimeContext, tool_name: str) -> str:
    """Mark a pending deferred/MCP tool loaded so next round's projection includes it.

    Returns the tool-result message telling the model to retry directly.
    Falls back to TOOL_NOT_YET_LOADED_TEMPLATE when the name is not in catalog.
    """
    name = str(tool_name or "").strip()
    descriptor = next((d for d in ts_ctx.catalog.descriptors if d.name == name), None)
    if descriptor is None:
        return TOOL_NOT_YET_LOADED_TEMPLATE.format(name=name or tool_name)
    thr = (
        int(ts_ctx.effective_threshold)
        if ts_ctx.effective_threshold is not None
        else int(ts_ctx.config.normalized().auto_schema_token_threshold)
    )
    max_loaded = resolve_max_loaded(
        effective_threshold=thr,
        core_schema_tokens=_estimate_core_schema_tokens(ts_ctx),
    )
    ts_ctx.state = mark_loaded(ts_ctx.state, [descriptor.stable_id], max_loaded=max_loaded)
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        scratchpad = {}
        try:
            setattr(session, "scratchpad", scratchpad)
        except Exception:
            pass
    if isinstance(scratchpad, dict):
        dump_state_to_scratchpad(scratchpad, ts_ctx.state)
    return TOOL_AUTO_LOADED_TEMPLATE.format(name=name)


def known_unloaded_names(ctx: ToolSearchRuntimeContext) -> set[str]:
    """Names in catalog that are deferred/MCP and not currently loaded."""
    loaded = set(ctx.state.loaded_ids)
    out: set[str] = set()
    for d in ctx.catalog.descriptors:
        if d.stable_id in loaded:
            continue
        if d.always_load or d.name in CORE_ALWAYS_LOAD_TOOLS:
            continue
        if d.kind == "mcp" or is_deferred_builtin(d.name):
            out.add(d.name)
    return out


def is_tool_pending_next_round(
    ctx: ToolSearchRuntimeContext,
    name: str,
    *,
    allowed_tool_names: set[str],
    full_openai_tools: list[dict],
) -> bool:
    """True when ``name`` is a deferred/MCP catalog tool missing from this round's projection.

    Includes the same-batch case: ``tool_search`` already marked the id loaded, but
    schemas only enter ``tools[]`` on the *next* model round.
    """
    name = str(name or "").strip()
    if not name or name in allowed_tool_names:
        return False
    if not _resolve_applied(ctx, full_openai_tools):
        return False
    for d in ctx.catalog.descriptors:
        if d.name != name:
            continue
        if d.always_load or d.name in CORE_ALWAYS_LOAD_TOOLS:
            return False
        return d.kind == "mcp" or is_deferred_builtin(d.name)
    return False
