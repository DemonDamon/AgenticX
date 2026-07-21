# SP2: ToolSearch Runtime Projection

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-tool-search-runtime-projection`  
Parent: `.cursor/plans/2026-07-21-agenticx-tool-search-master.plan.md`  
Depends-on: `2026-07-21-tool-search-core-contract`（已合并）

## Goal

把 SP1 投影接入 `AgentRuntime.run_turn` 逐轮 `active_tools`，注册并执行 `tool_search`，状态写入 session scratchpad；更新 Meta 提示纪律。本节点**不**接真实 MCP 动态 function（假 MCP descriptor 可用内存注入）；MCP hub 接线留给 SP5。

## Architecture

Turn 开始保留 `full_tool_pool` → 现有 `maybe_compact_meta_turn_context` → `project_tools_for_round` 得首轮 `active_tools`。每个 `round_idx` 开始前重新 project 并重建 `allowed_tool_names`。`tool_search` / 动态工具执行只通过**本轮**传入的 `runtime_tool_context`，禁止挂在 session 全局可变属性上。

## In scope

- `agenticx/cli/agent_tools.py`：`STUDIO_TOOLS` + `dispatch_tool_async`
- `agenticx/runtime/agent_runtime.py`：`run_turn` 投影循环
- `agenticx/runtime/prompts/meta_agent.py`：MCP/ToolSearch 纪律文案
- 可选薄封装：`agenticx/runtime/tool_search_runtime.py`（读 config.yaml + 组装 context）
- `tests/test_agent_runtime_tool_search.py`

## Out of scope / no-scope-creep

- 不改 `mcp_hub.py` / `build_mcp_tools_context`（SP3）
- 不改 Desktop（SP4）
- 不改 `server.py`（除非证明无法从 runtime 读 config；优先从 `ConfigManager` 读 `runtime.tool_search`）
- 不把默认 mode 改为 `auto`
- 不实现 Anthropic tool_reference

---

## 根因（本节点）

`run_turn` ~L2067 一次设定 `active_tools`，整 turn 复用；compact 后可能改 tools，但**没有**“检索后扩容”路径。`dispatch_tool_async` ~L7336 不认识 `tool_search`。

---

## FR / AC

| ID | Requirement | AC |
|----|-------------|-----|
| FR-1 | 注册 `tool_search` OpenAI schema | STUDIO_TOOLS/META 含该名；Fake LLM 可见 |
| FR-2 | mode=always 首轮仅 core+tool_search(+loaded) | `test_first_round_projected` |
| FR-3 | 调用后下一轮出现目标 builtin schema | `test_load_builtin_next_round` |
| FR-4 | 同批调用未加载工具 → 专用错误文案 | `test_same_batch_not_yet_loaded` |
| FR-5 | scratchpad 恢复后 loaded 仍投影 | `test_scratchpad_restore` |
| FR-6 | mode=off 与改动前工具名集合一致 | `test_mode_off_parity` |
| FR-7 | streaming 与 non-stream 均 project | 各至少 1 测 |
| FR-8 | Meta 提示：有 tool_search 优先搜 | 文案断言或字符串包含测 |

---

## Task 1: 注册 `tool_search` schema

**Modify:** `agenticx/cli/agent_tools.py` — `STUDIO_TOOLS` 列表（~L304 起）

在合适位置（建议紧邻 `mcp_call` / `list_mcps` 语义附近，或文件末尾 tools 区）追加：

```python
{
    "type": "function",
    "function": {
        "name": "tool_search",
        "description": (
            "Search deferred tools (builtin and connected MCP) by keyword. "
            "Matched tool schemas become available on the NEXT model round. "
            "Use select:<exact_name> for exact match; +token requires token."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
},
```

因 `META_AGENT_TOOLS = list(STUDIO_TOOLS) + [...]`（`meta_tools.py` ~L659），Meta 自动继承。

---

## Task 2: 配置读取薄封装

**Create (推荐):** `agenticx/runtime/tool_search_runtime.py`

```python
def read_tool_search_config() -> ToolSearchConfig:
    """Read ~/.agenticx/config.yaml runtime.tool_search; default mode=off."""

def build_builtin_catalog(openai_tools: list[dict]) -> ToolCatalog:
    """Wrap policy-filtered OpenAI tools into ToolDescriptors (kind=builtin)."""

def build_runtime_context(
    *,
    session,
    full_openai_tools: list[dict],
    mcp_descriptors: Sequence[ToolDescriptor] = (),
) -> ToolSearchRuntimeContext:
    """
    Merge builtin + mcp descriptors into catalog;
    load/prune state from session.scratchpad[TOOL_SEARCH_STATE_KEY];
    tool_search_allowed = "tool_search" in {names of full_openai_tools}.
    """
```

YAML 形状：

```yaml
runtime:
  tool_search:
    mode: off          # off | auto | always
    auto_schema_token_threshold: 6000
```

非法 mode → 回落 `off`。缺失节 → 默认 off。

---

## Task 3: `run_turn` 逐轮投影

**Modify:** `agenticx/runtime/agent_runtime.py` `AgentRuntime.run_turn` ~L2020+

**Before（现状意图）：**

```python
active_tools = studio_tools_for_session(...) if tools is None else tools
compact_prompt, compact_tools, compact_notice = maybe_compact_meta_turn_context(...)
if compact_notice:
    active_tools = compact_tools
allowed_tool_names = { ... from active_tools }
# loop: always pass same active_tools
```

**After（意图）：**

```python
full_tool_pool = list(studio_tools_for_session(...) if tools is None else tools)
# keep existing compaction on full pool / prompt
compact_prompt, compact_tools, compact_notice = maybe_compact_meta_turn_context(
    session, system_prompt=..., tools=list(full_tool_pool),
)
if compact_notice:
    current_system_prompt = compact_prompt
    full_tool_pool = list(compact_tools)

ts_ctx = build_runtime_context(session=session, full_openai_tools=full_tool_pool, mcp_descriptors=())
# mcp_descriptors 本节点可空；SP5 注入

def _project():
    nonlocal ts_ctx, active_tools, allowed_tool_names
    active_tools = project_tools_for_round(ts_ctx, full_openai_tools=full_tool_pool)
    allowed_tool_names = {name from active_tools}

_project()

# inside round loop, BEFORE each LLM call:
_project()
# when dispatching tools, pass runtime_tool_context=ts_ctx
# after tool_search mutates state: persist scratchpad via dump_state_to_scratchpad; update ts_ctx
```

同时：当 compact 在 turn 中再次触发（~L3220）时，先更新 `full_tool_pool`，再 `_project()`。

**会话属性禁令：** 不得 `session._tool_search_ctx = ...` 作为并发真相源；可用 turn 局部变量。scratchpad 仅持久化 `ToolSearchStateV1`。

---

## Task 4: dispatch `tool_search` + 同批未加载错误

**Modify:** `agenticx/cli/agent_tools.py` `dispatch_tool_async` ~L7336

**签名变更：**

```python
async def dispatch_tool_async(
    name: str,
    arguments: Dict[str, Any],
    session: Any,
    ...,
    runtime_tool_context: Any | None = None,  # NEW, default None
) -> Any:
```

所有现有调用点保持兼容（默认 None）。

**`tool_search` 分支：**

```python
if name == "tool_search":
    if runtime_tool_context is None:
        return json.dumps({"error": "tool_search unavailable in this context"})
    # call apply_search; dump state to session.scratchpad; return compact JSON string
```

**未知工具分支（~L3741 在 runtime 侧先拦；dispatch 内亦需）：**

若 `runtime_tool_context` 表明该名在 catalog 但是 deferred 且尚未 loaded：

```text
Tool '{name}' schema is not loaded yet. Call tool_search and retry on the next round.
```

不得当作普通 `Unknown tool`。Runtime 在 `tool_name not in allowed_tool_names`（~L3741）处：若属于“catalog 已知但未投影”，返回上述专用错误而非通用拒绝。

**接线：** `agent_runtime.py` 调用 `dispatch_tool_async` / sync wrapper 处传入 `runtime_tool_context=ts_ctx`（搜索现有 `dispatch_tool_async(` 调用）。

---

## Task 5: Meta 提示纪律

**Modify:** `agenticx/runtime/prompts/meta_agent.py` ~L890–899 MCP 纪律段

**Before：** 一律 `list_mcps` → `mcp_call`。

**After：**

- 若当前可用工具含 `tool_search`：优先 `tool_search` 发现 MCP/延迟内置工具；说明 schema 下一轮可用；`list_mcps`/`mcp_call` 仍作兼容路径。
- 若无 `tool_search`：保持原文案。

实现方式：在 `build_meta_agent_system_prompt(...)` 根据传入 tools 名集合或 session 标志选择段落；**不要**删掉现有 list_mcps 纪律。

---

## Task 6: 测试

**Create:** `tests/test_agent_runtime_tool_search.py`

用 Fake LLM（仓库已有 pattern：搜 `tests/test_smoke_*` / Fake provider）模拟两轮：

1. Round0：断言传入 tools 名 ⊆ core ∪ {tool_search}（mode=always，空 scratchpad）。
2. 模型调用 `tool_search(query="select:web_fetch")`（或某 defer 工具）。
3. Round1：断言 `web_fetch` schema 出现在 tools；模型成功调用。
4. `mode=off`：传入工具名集合 == full pool。
5. scratchpad 预置 loaded_ids：首轮即含该工具。
6. streaming 路径至少 1 条（若 Fake 支持 `stream_with_tools`）。

```bash
pytest -q tests/test_agent_runtime_tool_search.py tests/test_tool_search.py
```

---

## Commit 边界

允许：

- `agenticx/cli/agent_tools.py`
- `agenticx/runtime/agent_runtime.py`
- `agenticx/runtime/prompts/meta_agent.py`
- `agenticx/runtime/tool_search_runtime.py`（若新建）
- `tests/test_agent_runtime_tool_search.py`
- 本 plan

禁止顺手改 Desktop、MCP hub、默认配置。
