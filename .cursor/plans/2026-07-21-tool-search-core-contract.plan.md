# SP1: ToolSearch Core Contract

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-tool-search-core-contract`  
Parent: `.cursor/plans/2026-07-21-agenticx-tool-search-master.plan.md`

## Goal

落地纯函数模块 `agenticx/runtime/tool_search.py` + `tests/test_tool_search.py`，冻结目录/检索/状态/投影 API，**零运行时接线**。

## Architecture

所有后续节点只依赖本模块公开函数与数据类；不 import `AgentRuntime` / `MCPHub` / Desktop。MCP 描述符以 plain dataclass 输入，不在本节点访问 hub 私有字段。

## In scope

- 新建 `agenticx/runtime/tool_search.py`
- 新建 `tests/test_tool_search.py`
- 冻结常量：scratchpad key、LRU、mode、core/defer allowlist、public name 规则

## Out of scope / no-scope-creep

- 不改 `agent_runtime.py`、`agent_tools.py`、`mcp_hub.py`、`studio_mcp.py`、Desktop、`server.py`
- 不注册 `tool_search` 到 STUDIO_TOOLS（SP2）
- 不实现 embedding

---

## FR / AC

| ID | Requirement | AC |
|----|-------------|-----|
| FR-1 | `ToolDescriptor` / config / state / catalog 类型完整 | `tests/test_tool_search.py` 可构造并序列化 round-trip |
| FR-2 | MCP public name 规范化 ≤64、安全字符、冲突 hash | `test_mcp_public_name_*` |
| FR-3 | 确定性 ranking：exact/`select:`/`+required`/tokens/hints/desc | `test_rank_*` |
| FR-4 | 投影：core + tool_search + loaded；defer 不出现 | `test_project_tools_*` |
| FR-5 | scratchpad 状态 LRU 24 + fingerprint prune | `test_state_*` |
| FR-6 | mode off / auto / always + fail-open | `test_mode_*` |
| FR-7 | schema token 粗估与 catalog fingerprint 稳定 | `test_estimate_*` / `test_fingerprint_*` |

---

## Task 1: 创建模块骨架与常量

**Create:** `agenticx/runtime/tool_search.py`

**必须导出的常量（写死，禁止节点内改名）：**

```python
TOOL_SEARCH_STATE_KEY = "__tool_search_state_v1__"
TOOL_SEARCH_TOOL_NAME = "tool_search"
TOOL_SEARCH_MAX_LOADED = 24
DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD = 6000

# 首版核心常驻（至少包含；可多不可少）
CORE_ALWAYS_LOAD_TOOLS: frozenset[str] = frozenset({
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
})

# 显式 defer：不在 CORE 且属于策略后池中的内置工具才可 defer
# 实施时从 STUDIO_TOOLS/META 差集生成初版，并在文件内写成 frozenset 字面量
# 新工具默认不在此集合 → 常驻
BUILTIN_DEFER_ALLOWLIST: frozenset[str] = frozenset({...})  # 见 Task 1 步骤
```

**注意：** 写 allowlist 前再扫一遍 `META_AGENT_TOOLS` 真实工具名（`meta_tools.py` ~L659；`agent_tools.py` `STUDIO_TOOLS` ~L304）。上表已按当前仓库核对：`query_subagent_status` / `send_message_to_agent`。若实施时名称有漂移，以仓库现名为准并在 commit 注明最终 CORE 名单。

**数据类（可用 dataclass）：**

```python
@dataclass(frozen=True)
class ToolDescriptor:
    stable_id: str          # builtin:<name> | mcp:<serverSlug>:<toolSlug>
    name: str               # provider-facing function name（MCP 用 public name）
    kind: str               # "builtin" | "mcp"
    description: str
    input_schema: dict      # JSON Schema object
    search_hints: tuple[str, ...] = ()
    server_slug: str | None = None
    original_mcp_name: str | None = None   # hub routed name for execution
    always_load: bool = False

@dataclass(frozen=True)
class ToolSearchConfig:
    mode: str  # "off" | "auto" | "always"
    auto_schema_token_threshold: int = DEFAULT_AUTO_SCHEMA_TOKEN_THRESHOLD

@dataclass
class ToolSearchStateV1:
    loaded_ids: list[str]           # ordered, LRU:最近使用靠后
    catalog_fingerprint: str
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
    tool_search_allowed: bool       # False → fail-open
```

---

## Task 2: 名称规范化与估算

实现并单测：

```python
def slugify_mcp_segment(raw: str) -> str:
    """[a-zA-Z0-9_-] only; collapse; lower-case preferred."""

def make_mcp_public_name(server: str, tool: str, *, existing: set[str]) -> str:
    """mcp__{server}__{tool}; if >64 or collision, truncate + '_' + 6-char stable hash."""

def estimate_schema_tokens(tools: list[dict]) -> int:
    """Rough: len(json.dumps(tools, ensure_ascii=False, separators=(',', ':'))) // 3.5 → int."""

def catalog_fingerprint(descriptors: Sequence[ToolDescriptor]) -> str:
    """SHA256 over sorted (stable_id, name, description, canonical_schema_json)."""
```

**AC：**
- `mcp__photos__search_albums_very_long...` 截断后 ≤64 且稳定。
- 同名冲突两次调用得到不同 public name，但同一输入+existing 集合结果确定。

---

## Task 3: Ranking

```python
def rank_tools(query: str, catalog: ToolCatalog, *, max_results: int = 5) -> list[ToolDescriptor]:
```

规则（按优先级加分，同分按 `stable_id` 字典序）：

1. `select:<exact_name>` 或 query 与 `name` 完全相等 → 最高分，唯一命中可直接返回。
2. query 以 `mcp__` / server slug 前缀 → 优先该 server。
3. token 前带 `+` → 必须全部出现在 name/hints/description（大小写不敏感），否则淘汰。
4. name token 命中 > hints > description 子串。
5. `max_results` clamp 到 1..20。

**禁止：** 随机、时间、embedding。

---

## Task 4: 状态读写与 LRU

```python
def load_state_from_scratchpad(scratchpad: dict | None) -> ToolSearchStateV1: ...
def dump_state_to_scratchpad(scratchpad: dict, state: ToolSearchStateV1) -> None: ...
def prune_state_to_catalog(state: ToolSearchStateV1, catalog: ToolCatalog) -> ToolSearchStateV1: ...
def mark_loaded(state: ToolSearchStateV1, ids: Sequence[str]) -> ToolSearchStateV1:
    """Append/touch ids; drop oldest when > TOOL_SEARCH_MAX_LOADED."""
```

- 未知键忽略；损坏 JSON → 空 state。
- fingerprint 变化：保留仍在 catalog 的 loaded_ids，丢掉 stale。

---

## Task 5: 投影与 mode 决策

```python
def should_apply_tool_search(
    config: ToolSearchConfig,
    *,
    full_pool_schema_tokens: int,
    tool_search_allowed: bool,
) -> bool:
    """
    tool_search_allowed False → False (caller fail-opens to full pool).
    mode off → False
    mode always → True
    mode auto → full_pool_schema_tokens >= threshold
    """

def project_tools_for_round(
    ctx: ToolSearchRuntimeContext,
    *,
    full_openai_tools: list[dict],  # policy-filtered OpenAI function tools
) -> list[dict]:
    """
    If not should_apply: return full_openai_tools unchanged (same object identity optional).
    If apply:
      - include schemas for: CORE_ALWAYS_LOAD ∩ pool, tool_search, loaded ∩ pool
      - MCP descriptors that are loaded appear as OpenAI function tools by public name
      - deferred builtins NOT loaded → omitted
    """

def apply_search(
    ctx: ToolSearchRuntimeContext,
    query: str,
    *,
    max_results: int = 5,
) -> tuple[ToolSearchRuntimeContext, dict]:
    """
    Rank, mark_loaded, return new ctx + compact result dict:
    {
      "matches": [{"name", "stable_id", "description"}],
      "loaded_names": [...],
      "note": "Schemas will be available on the next model round."
    }
    Do NOT include full input_schema in result.
    """
```

**Fail-open 语义（写进 docstring）：**  
当 `tool_search_allowed is False` 或 `mode==off` 或（auto 且未超阈值）时，`project_tools_for_round` 返回完整 `full_openai_tools`，与今天一致。

---

## Task 6: 测试

**Create:** `tests/test_tool_search.py`

最少用例：

1. `test_select_exact_name`
2. `test_plus_required_filters`
3. `test_rank_stable_tiebreak`
4. `test_mcp_public_name_collision_and_64`
5. `test_lru_evicts_oldest`
6. `test_fingerprint_change_prunes_stale`
7. `test_mode_off_returns_full_pool`
8. `test_mode_auto_threshold`
9. `test_fail_open_when_tool_search_disallowed`
10. `test_project_omits_deferred_until_loaded`
11. `test_apply_search_result_has_no_full_schema`

```bash
pytest -q tests/test_tool_search.py
```

Expected: PASS，且本节点 `git diff` 仅含上述两文件（+ 本 plan 若同 commit）。

---

## Commit 边界

只允许：

- `agenticx/runtime/tool_search.py`
- `tests/test_tool_search.py`
- 本 plan 文件（若尚未提交）

Trailers（用户确认模型后）：`Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`
