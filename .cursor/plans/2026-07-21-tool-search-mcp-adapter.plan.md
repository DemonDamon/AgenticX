# SP3: ToolSearch MCP Catalog Adapter

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-tool-search-mcp-adapter`  
Parent: `.cursor/plans/2026-07-21-agenticx-tool-search-master.plan.md`  
Depends-on: `2026-07-21-tool-search-core-contract`（已合并）

## Goal

为 MCP 提供只读公开快照与 descriptor 转换（含 public-name 双向映射），并在 ToolSearch **applied** 时停止向系统提示倾倒全量 MCP schema。本节点**不**改 `AgentRuntime` 投影循环（SP2）与动态执行（SP5）。

## Architecture

`MCPHub` 暴露只读 snapshot → `mcp_tool_catalog.py` 转为 `ToolDescriptor` → SP5 注入 `build_runtime_context(mcp_descriptors=...)`。`build_mcp_tools_context` 增加 defer 模式参数/检测，避免 ToolSearch 开启后仍浪费 6000 chars 提示配额。

## In scope

- `agenticx/tools/mcp_hub.py`：公开快照 API
- **Create** `agenticx/runtime/mcp_tool_catalog.py`
- `agenticx/cli/studio_mcp.py`：`build_mcp_tools_context` defer 行为
- `agenticx/runtime/agent_runtime.py`：`_build_agent_system_prompt` 调用处传 defer 标志（**仅改这一调用**，不碰 run_turn 投影）
- `tests/test_tool_search_mcp_catalog.py`（及必要时扩展既有 MCP 测）

## Out of scope / no-scope-creep

- 不改 Desktop、不改 `dispatch_tool_async` 动态 MCP function（SP5）
- 不改变 MCP 连接/断开生命周期
- 不删除 `list_mcps` / `mcp_call`
- 不重构 `_resolve_routed_name` 算法语义（可复用其结果作为 `original_mcp_name`）

---

## 根因（本节点）

1. 外部代码直接读 `hub._tool_routing`（`studio_mcp.py` ~L53、~L1137），无稳定公开 API。  
2. `build_mcp_tools_context` ~L1120–1148 把 description + inputSchema 写入系统提示；`_build_agent_system_prompt` ~L1005–1046 再截断 6000。ToolSearch 若不关掉倾倒，MCP 侧几乎不省 token。

---

## FR / AC

| ID | Requirement | AC |
|----|-------------|-----|
| FR-1 | 公开只读 snapshot，不暴露可写 `_tool_routing` | 单测只调公开 API |
| FR-2 | descriptor 含 public name、routed name、schema 原样 | `test_schema_passthrough` |
| FR-3 | 同名跨 server 不串 | `test_cross_server_isolation` |
| FR-4 | 断开后 snapshot 无该工具；重连 stable_id 可恢复 | `test_disconnect_reconnect` |
| FR-5 | `mcp_call` 不在 full pool 时候选为 0 | `test_parent_gate_mcp_call` |
| FR-6 | ToolSearch applied 时 context **不含** inputSchema 倾倒 | `test_build_mcp_tools_context_deferred` |
| FR-7 | ToolSearch off 时 context 行为与今天兼容（可仍含 schema，或仅测回归字符串结构） | `test_build_mcp_tools_context_legacy` |

---

## Task 1: MCPHub 公开快照

**Modify:** `agenticx/tools/mcp_hub.py`

在 `MCPHub` 类（~L109）新增：

```python
@dataclass(frozen=True)
class MCPToolSnapshot:
    server_name: str
    original_name: str      # MCP 协议侧工具名
    routed_name: str        # hub._tool_routing 的 key（执行用）
    description: str
    input_schema: dict      # 深拷贝，防止外部 mutation
    enabled: bool           # 未被 disabled_tools 配置关掉

def list_tool_snapshots(self) -> list[MCPToolSnapshot]:
    """Read-only snapshot of currently discovered/routed tools."""
```

实现要点：

- 遍历 `self._tool_routing.items()` 内部构建，**不要**让调用方拿到 route 对象。
- `input_schema` 使用 `copy.deepcopy(route.tool_info.inputSchema or {})`。
- `enabled`：复用 `get_mcp_disabled_tools_config()`（与 `build_mcp_tools_context` 同一规则，`studio_mcp.py` ~L1129–1141）。
- 若 routing 为空，返回 `[]`（不在此方法内强制 `discover_all_tools`，避免副作用；调用方可先 discover）。

可选：`get_tool_snapshot(routed_name: str) -> MCPToolSnapshot | None`。

---

## Task 2: `mcp_tool_catalog.py`

**Create:** `agenticx/runtime/mcp_tool_catalog.py`

```python
def snapshots_to_descriptors(
    snapshots: Sequence[MCPToolSnapshot],
    *,
    mcp_call_allowed: bool,
) -> list[ToolDescriptor]:
    """
    If not mcp_call_allowed: return [].
    Skip enabled=False.
    stable_id = f"mcp:{server_slug}:{tool_slug}"
    name = make_mcp_public_name(...)  # from tool_search.py
    original_mcp_name = snapshot.routed_name
    always_load = False
    """

def resolve_mcp_execution_name(
    public_or_routed: str,
    descriptors: Sequence[ToolDescriptor],
) -> str | None:
    """Map public name → routed_name; also accept already-routed names."""
```

父门禁：`mcp_call_allowed` 由调用方根据 full builtin pool 是否含 `mcp_call` 传入。

---

## Task 3: 系统提示倾倒约束（关键）

**Modify:** `agenticx/cli/studio_mcp.py` `build_mcp_tools_context` ~L1120

**Before：** 对每个工具打印描述 + 最多 500 字符 schema。

**After：**

```python
def build_mcp_tools_context(
    hub: "MCPHub",
    *,
    defer_schemas: bool = False,
    loaded_public_or_routed_names: set[str] | None = None,
) -> str:
```

行为：

| `defer_schemas` | 行为 |
|-----------------|------|
| `False`（默认） | 与今天一致：名称+描述+截断 schema（兼容旧路径） |
| `True` | **禁止**打印 inputSchema。仅输出：已连接 server、工具公开名或 routed 名列表、一句话指引「用 tool_search 加载后下一轮可调用；兼容路径 list_mcps/mcp_call」。若提供 `loaded_*`，可额外列出已加载子集的简短描述（仍无 schema） |

**Modify:** `agenticx/runtime/agent_runtime.py` `_build_agent_system_prompt` ~L1002–1006

```python
# When runtime.tool_search is applied for this session/turn, pass defer_schemas=True.
# Read config via read_tool_search_config(); if mode off → defer_schemas=False.
# Ideal: also check should_apply_tool_search with a cheap token estimate of META tools,
# but if estimate unavailable, mode in {auto, always} → defer_schemas=True is acceptable for v1
# ONLY when mode != off. Document this approximation in code comment.
mcp_context = build_mcp_tools_context(session.mcp_hub, defer_schemas=...)
```

**注意：** Meta 主路径系统提示在 `build_meta_agent_system_prompt`；若 Meta 也注入 MCP 上下文，搜索 `build_mcp_tools_context(` 全仓库，**每一处**在 ToolSearch 启用时传 `defer_schemas=True`。禁止漏改导致一侧仍倾倒。

```bash
rg -n "build_mcp_tools_context" -g '*.py'
```

---

## Task 4: 测试

**Create:** `tests/test_tool_search_mcp_catalog.py`

用假 `MCPHub` / 轻量 fake clients（参考 `tests/test_mcp_tool_manager.py` 或现有 MCP 测）：

1. 两个 server 同名 tool → 不同 public name / routed name，互不串。  
2. schema 字段原样。  
3. disabled tool 不进 descriptors。  
4. `mcp_call_allowed=False` → `[]`。  
5. `build_mcp_tools_context(..., defer_schemas=True)` 断言 `"inputSchema"` / `"输入Schema"` 不出现，且含 `tool_search` 指引。  
6. `defer_schemas=False` 仍含 schema 片段（回归）。

```bash
pytest -q tests/test_tool_search_mcp_catalog.py tests/test_tool_search.py
```

---

## Commit 边界

允许：

- `agenticx/tools/mcp_hub.py`
- `agenticx/runtime/mcp_tool_catalog.py`
- `agenticx/cli/studio_mcp.py`
- `agenticx/runtime/agent_runtime.py`（仅 `_build_agent_system_prompt` / `build_mcp_tools_context` 调用点）
- `agenticx/runtime/prompts/meta_agent.py`（若 Meta 也调用 `build_mcp_tools_context`）
- `tests/test_tool_search_mcp_catalog.py`
- 本 plan

若与 SP2 并行：`agent_runtime.py` 冲突时以 worktree 合并，**只保留**各自责任 hunk，禁止互相覆盖投影逻辑与 prompt 逻辑。
