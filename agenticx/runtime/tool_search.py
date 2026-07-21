"""Provider-agnostic ToolSearch: catalog, ranking, state, and projection.

Pure functions only — no AgentRuntime / MCPHub / Desktop imports.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

TOOL_SEARCH_STATE_KEY = "__tool_search_state_v1__"
TOOL_SEARCH_TOOL_NAME = "tool_search"
TOOL_SEARCH_MAX_LOADED = 24
DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD = 6000

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

# Explicit defer allowlist: tools not listed here default to always-load.
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
        "show_widget",
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
    mode: str = "off"  # "off" | "auto" | "always"
    auto_schema_token_threshold: int = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD

    def normalized(self) -> "ToolSearchConfig":
        mode = (self.mode or "off").strip().lower()
        if mode not in _VALID_MODES:
            mode = "off"
        threshold = int(self.auto_schema_token_threshold or DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD)
        if threshold < 1:
            threshold = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD
        return ToolSearchConfig(mode=mode, auto_schema_token_threshold=threshold)


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


def mark_loaded(state: ToolSearchStateV1, ids: Sequence[str]) -> ToolSearchStateV1:
    """Append/touch ids (LRU: most recent at end); evict oldest beyond max."""
    loaded = [sid for sid in state.loaded_ids if sid]
    for sid in ids:
        sid_s = str(sid or "").strip()
        if not sid_s:
            continue
        if sid_s in loaded:
            loaded.remove(sid_s)
        loaded.append(sid_s)
    while len(loaded) > TOOL_SEARCH_MAX_LOADED:
        loaded.pop(0)
    return ToolSearchStateV1(
        loaded_ids=loaded,
        catalog_fingerprint=state.catalog_fingerprint,
        version=state.version,
    )


def should_apply_tool_search(
    config: ToolSearchConfig,
    *,
    full_pool_schema_tokens: int,
    tool_search_allowed: bool,
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
    # auto
    return int(full_pool_schema_tokens) >= int(cfg.auto_schema_token_threshold)


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
    tokens = estimate_schema_tokens(list(full_openai_tools))
    if not should_apply_tool_search(
        ctx.config,
        full_pool_schema_tokens=tokens,
        tool_search_allowed=ctx.tool_search_allowed,
    ):
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
        if name in BUILTIN_DEFER_ALLOWLIST:
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
    new_state = mark_loaded(ctx.state, ids)
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
    return name in BUILTIN_DEFER_ALLOWLIST and name not in CORE_ALWAYS_LOAD_TOOLS


def known_unloaded_names(ctx: ToolSearchRuntimeContext) -> set[str]:
    """Names in catalog that are deferred/MCP and not currently loaded."""
    loaded = set(ctx.state.loaded_ids)
    out: set[str] = set()
    for d in ctx.catalog.descriptors:
        if d.stable_id in loaded:
            continue
        if d.always_load or d.name in CORE_ALWAYS_LOAD_TOOLS:
            continue
        if d.kind == "mcp" or d.name in BUILTIN_DEFER_ALLOWLIST:
            out.add(d.name)
    return out
