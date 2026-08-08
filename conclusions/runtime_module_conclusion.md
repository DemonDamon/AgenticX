# AgenticX Runtime 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-04-29 之后的变更）

## 目录路径

`agenticx/runtime/`

## 模块概述

Runtime 模块是 AgenticX Studio 的核心执行引擎，负责驱动 Meta-Agent 与子智能体的完整生命周期：LLM 调用、工具分发、流式输出、上下文压缩、循环检测、确认门控、Hook 扩展以及多智能体团队调度。所有对话轮次通过 `AgentRuntime.run_turn()` 以 AsyncGenerator 形式发射 `RuntimeEvent` 事件流，供上层（Studio Server / Desktop）订阅转换。

---

## 目录结构

```
agenticx/runtime/
├── __init__.py             # 导出核心类
├── agent_runtime.py        # AgentRuntime 核心 LLM 驱动循环
├── team_manager.py         # AgentTeamManager 多子智能体调度
├── events.py               # EventType 枚举 + RuntimeEvent 数据类
├── hooks/
│   ├── __init__.py         # AgentHook / HookRegistry / HookOutcome
│   ├── memory_hook.py      # MemoryHook：on_agent_end 自动提取记忆
│   ├── legacy_event_bridge_hook.py  # 将运行时 hook 桥接到全局 hook 总线
│   └── session_summary_hook.py      # 跨会话延续的会话摘要（AGX_SESSION_SUMMARY）
├── prompts/
│   ├── meta_agent.py       # Meta-Agent 系统提示构建器
│   ├── code_mode.py        # (NEW) code_dev harness 模式系统提示块（仓库骨架 + 已读文件）
│   └── credential_safety.py # (NEW) 共享凭据/密钥安全指令块
├── compactor.py            # ContextCompactor：历史消息压缩
├── confirm.py              # ConfirmGate / AsyncConfirmGate / AutoApproveConfirmGate
├── auto_solve.py           # 自动求解辅助
├── loop_controller.py      # 循环控制
├── loop_detector.py        # LoopDetector：工具调用循环检测
├── meta_tools.py           # Meta-only 工具（spawn_subagent / delegate_to_avatar）分发
├── resource_monitor.py     # ResourceMonitor：spawn 前资源检查
├── scratchpad.py           # Scratchpad 工具实现
├── todo_manager.py         # TodoManager：结构化 Todo 跟踪
├── group_router.py         # GroupChatRouter：群聊路由 + Workforce 自动 dispatch
├── stall_policy.py         # (NEW) 停滞检测（与桌面 task-stall-policy 对齐）
├── session_mode.py         # (NEW) 会话 harness 模式（code_dev / daily_office / feature_loop）
├── code_outline.py         # (NEW) code_outline 工具的 AST/轻量纲要提取
├── code_read_cache.py      # (NEW) 记录 file_read 范围到 scratchpad（code_dev）
├── followup_stream.py      # (NEW) 从流式/最终文本剥离 <followups> 追问块
├── global_mcp_manager.py   # (NEW) 进程级 MCP 单例（共享 MCPHub + connected_servers）
├── global_mcp_state.py     # (NEW) 最近连接 MCP 服务名持久化（mcp_state.json）
├── tool_result_budget.py   # (NEW) 工具结果上下文预算：归档 / 分类 / 衰减
├── token_budget.py         # token 预算治理与超限事件
├── usage_store.py          # (NEW) LLM 用量落 ~/.agenticx/usage.sqlite
├── model_pricing.py        # (NEW) 按 1M tokens 估算成本（config.yaml 可覆盖）
└── usage_metadata.py       # 用量元数据（Token SSE）
```

---

## 核心组件分析

### AgentRuntime（agent_runtime.py）

**功能**：LLM 驱动的单轮执行核心，支持流式与非流式 LLM 路径。

**关键参数**：
- `llm`：LLM 实例，优先使用 `stream_with_tools()` 路径，回退到 `invoke()`
- `confirm_gate`：`ConfirmGate`，用于工具执行前的用户确认
- `max_tool_rounds`：单轮最大工具调用轮数，默认 10
- `hooks`：`HookRegistry`，支持 before_model / after_tool_call 等生命周期拦截
- `team_manager`：`AgentTeamManager`，处理 meta-only 工具（spawn_subagent 等）

**执行流程**：
1. 历史消息清洗：`_sanitize_context_messages()` 强制 tool_calls/tool 消息合法配对
2. 上下文压缩：`ContextCompactor.maybe_compact()` 触发历史消息摘要压缩
3. LLM 调用：优先 `stream_with_tools()`（流式 token + tool_call_delta），回退 `invoke()`
4. 工具调用过滤：流式累积和非流式响应均过滤 tool_name 为空字符串或字面量 `"none"` 的无效条目（部分 provider 会产生此类帧），过滤时记录 warning 日志
5. 内联工具解析：从文本中提取 `<tool_code>` 格式的工具调用
6. 工具分发：meta-only 工具走 `meta_tools.dispatch_meta_tool_async()`，其余走 `dispatch_tool_async()`
7. 循环检测：`LoopDetector` 记录每轮工具调用，warning/critical 两级处理
8. 状态查询节流：`query_subagent_status` 每轮至多 1 次，跨轮需冷却 8s

**超时体系**：
- `AGX_LLM_INVOKE_TIMEOUT_SECONDS`：首次响应超时，默认 120s；volcengine/bailian 180s
- `AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS`：流式心跳超时，默认 60s
- `AGX_LLM_HARD_TIMEOUT_SECONDS`：单次调用绝对上限，默认 300s
- `AGX_LLM_FIRST_FEEDBACK_SECONDS`：等待超此时长后提示 ⏳，默认 8s

**发射的 EventType**：
`ROUND_START`, `TOKEN`, `TOOL_CALL`, `TOOL_RESULT`, `CONFIRM_REQUIRED`, `CONFIRM_RESPONSE`, `COMPACTION`, `SUBAGENT_CHECKPOINT`, `SUBAGENT_PAUSED`, `FINAL`, `ERROR`

**系统提示结构**（执行型 Agent）：
- Skills 摘要、当前 artifacts、Todo 列表、Scratchpad 摘要、context_files、MCP 工具上下文、安全确认规则
- 信息不足/需求含糊时，要求直接以文字回复追问用户，不调用工具

---

### AgentTeamManager（team_manager.py）

**功能**：管理多个并发子智能体的生命周期，支持 spawn / cancel / retry / send_message。

**关键数据结构**：
- `SubAgentContext`：子智能体状态快照，包含 agent_id、status、task、artifacts、recent_events、output_files、spawn_tree_path 等
- `SubAgentStatus`：`pending | running | completed | failed | cancelled`
- `SpawnConfig`：`max_spawn_depth=2`、`max_children_per_agent=5`、`max_concurrent=8`、`run_timeout_seconds=600`

**生命周期**：
- `spawn_subagent()`：创建隔离 session，启动 asyncio Task，注册至 `_agents` 字典
- `_run_subagent()`：执行 `AgentRuntime.run_turn()` 循环，含心跳任务（每 3s progress 事件）
- 完成后调用 `_archive_context()`：轻量快照存入 `_archived_agents`（保留 200 条）
- `_registry`：全局类级别注册表，支持 `collect_global_statuses()` 跨 manager 聚合

**关键机制**：
- **会话隔离**：`_build_isolated_session()` 共享 MCP 配置，独立消息/artifacts
- **父上下文注入**：`_build_parent_context_summary()` 取父会话最近 10 条对话注入子 Agent 系统提示
- **产出文件追踪**：从 `file_write`/`file_edit` 工具返回的 `OK: wrote/edited` 解析文件路径写入 `output_files`
- **结果回写 scratchpad**：完成后将摘要写入 `base_session.scratchpad["subagent_result::<agent_id>"]`
- **流式 token 缓冲**：120 字符或 0.2s 刷新一次，减少 SSE 事件数量
- **工具白名单 fallback**：`allowed_tool_names` 为空时回退到完整工具集，避免因配置失误导致全无工具可用
- **进程内注销**：`shutdown()` / `shutdown_now()` 取消所有 tasks 并从 `_registry` 注销

---

### 事件协议（events.py）

**EventType 枚举**（完整列表）：
```
ROUND_START, TOOL_CALL, TOOL_RESULT, CONFIRM_REQUIRED, CONFIRM_RESPONSE,
TOKEN, FINAL, ERROR,
SUBAGENT_STARTED, SUBAGENT_PROGRESS, SUBAGENT_CHECKPOINT,
SUBAGENT_PAUSED, SUBAGENT_COMPLETED, SUBAGENT_ERROR,
COMPACTION
```

**RuntimeEvent**：`type: str`、`data: Dict[str, Any]`、`agent_id: str`（默认 `"meta"`）

---

### Hook 系统（hooks/）

**AgentHook**（基类，hooks/__init__.py）：
- 可选覆盖的生命周期方法：`before_model`、`after_model`、`before_tool_call`、`after_tool_call`、`on_compaction`、`on_agent_end`

**HookRegistry**：
- `register(hook, priority=0)`：按优先级排序，数值越高越先执行
- `run_before_tool_call()`：返回 `HookOutcome`，`blocked=True` 则阻止工具执行

**HookOutcome**：`blocked: bool`、`reason: str`

**MemoryHook**（hooks/memory_hook.py）：
- 在 `on_agent_end` 触发（对话 ≥6 轮时）
- 启发式提取含中文请求/完成关键词的消息作为 facts（最多 8 条）
- 写入 `<workspace_dir>/memory/<today>.md`（daily memory）
- 当 MEMORY.md < 4000 chars 时追加到 `<workspace_dir>/MEMORY.md`（长期记忆）
- `_maybe_compact_daily()`：daily memory > 2000 chars 时去重压缩
- 同时写入 session scratchpad 的 `session_facts` 键
- 注册优先级 -10（最后执行）

---

### Meta-Agent 系统提示（prompts/meta_agent.py）

**功能**：构建 Meta-Agent（CEO 角色）的完整系统提示，每轮动态注入。

**注入内容**：
- 身份与长期上下文（workspace IDENTITY.md / USER.md / SOUL.md / MEMORY.md / 今日 daily memory）
- 活跃子智能体快照（`_build_active_subagents_context`）
- 记忆自动召回（`_build_memory_recall_context`）
- Skills 摘要（来自 `get_all_skill_summaries()`）
- MCP 服务器列表（已连接/未连接）
- Avatars 列表
- Todo 当前状态
- 安全与权限规则

---

### Meta-Agent 工具分发（meta_tools.py）

**功能**：分发 Meta-Agent 专属工具（spawn_subagent、cancel_subagent、retry_subagent、query_subagent_status、delegate_to_avatar 等），并处理相应逻辑。

**真委派机制 — delegate_to_avatar**：

Meta-Agent 通过 `delegate_to_avatar(avatar_id, task)` 将任务注入目标分身的真实 session，而非派生同名 spawn：

- `_find_or_create_avatar_session(session_manager, avatar_id, avatar_config)`：优先从内存 `_sessions` 查找最新未归档的 avatar session，回退到持久化记录 `list_sessions(avatar_id=)`，均无则用 avatar 默认 provider/model 创建新 session
- `_run_delegation_in_avatar_session()`：在 avatar session 中独立执行 `AgentRuntime.run_turn()` 循环
  - 使用 avatar 专属 system prompt（含身份、角色、workspace、规则：禁止同名 spawn、禁止 delegate_to_avatar）
  - 工具集为 `META_AGENT_TOOLS` 中去除 `delegate_to_avatar` 的子集
  - LLM provider 优先级：avatar 配置 > session 已有 > Meta-Agent fallback
  - 执行结果通过 `delegation_started / delegation_done / delegation_error` 事件回传
  - 完成后将摘要写入 Meta-Agent scratchpad 的 `delegation_result::<delegation_id>` 键
- 防重入：同一 avatar 同时只允许一个 delegation task（检查 `_delegation_task.done()`）
- delegation_id 格式：`dlg-<8hex>`

**spawn_subagent 与 avatar 冲突检测**：

当 spawn_subagent 请求的名称匹配到已注册 Avatar 时，自动拦截并提示改用 `delegate_to_avatar`。

---

### 确认门控（confirm.py）

- `ConfirmGate`：同步确认基类
- `AsyncConfirmGate`：异步确认，支持 await、`last_request` 记录最近一次请求
- `AutoApproveConfirmGate`：子智能体专用，自动通过所有确认请求

---

### ContextCompactor（compactor.py）

- `maybe_compact(history)`：历史消息超阈值时调用 LLM 生成摘要，返回压缩后的 messages + did_compact + summary + compacted_count

---

### LoopDetector（loop_detector.py）

- 记录工具调用序列，检测无进展重复模式
- `warning_threshold=4`：emitting 警告提示
- `critical_threshold=8`：终止当前 Agent 执行

---

### ResourceMonitor（resource_monitor.py）

- `can_spawn(active_subagents)`：检查系统资源（CPU/内存），返回 `{"allowed": bool, ...}`
- spawn 前自动调用，资源紧张时拒绝新 spawn

---

## 2026-04-29 之后的主要变更（NEW）

### 长任务韧性与续跑

- **stall_policy.py**：停滞检测的 Python 端实现，与 Desktop `task-stall-policy` 对齐。`evaluate_stall_for_continuation()` 结合通道 C 宽限期（`CHANNEL_C_GRACE_SEC=5s`）、未完成尾标点（`:：,，;；、—…`）启发式与 todo 完成度判断是否需要续跑；被 Studio `supervisor.py` 与 `/api/sessions/<sid>/continue` 复用。
- **agent_runtime.py**：截断/未完成的流式 tool_calls 会强制下一轮 LLM 重试（commit `4ed8aecd`）；为 MiniMax provider 降级非首条 system 消息（`ef769d2c`）；Kimi/Moonshot 调用前剔除空 assistant 行、给带 tool_calls 的空内容补占位（`62991535`）。

### 工具结果上下文预算（M1）

- **tool_result_budget.py**：`apply_tool_result_budget()` 在每次 LLM 请求前按 `TOOL_RESULT_CLASS`（small/medium/large）分类工具结果，将过期的大结果衰减为引用摘要，原始内容归档到 session `tool_archives/`（commit `1c4ea40d`）。与 `token_budget.py` 协同做长工具链治理。

### 原生 URL + 视觉工具

- `agent_runtime.py` 新增 `web_fetch`（抓取 URL 文本 + 发现页内图片）与 `view_image`（把选中图片注入下一轮 LLM 做视觉分析，带 vision guard）；`is_vision_capable()` 统一于 `agenticx/llms/vision.py`；runtime 在下一次 LLM 调用前注入待处理视觉附件（Plan `2026-05-26-agent-url-vision`）。

### 会话 harness 模式 / code_dev

- **session_mode.py**：定义 `code_dev` / `daily_office` / `feature_loop` 模式与 `explore`/`read`/`author` 阶段门，以及 scratchpad 前缀键。
- **code_outline.py** / **code_read_cache.py** / **prompts/code_mode.py**：构成 code_dev 四层上下文——AST 纲要、已读文件范围缓存、仓库骨架与已读文件提示块（Plan `code_dev harness`）。

### 进程级 MCP

- **global_mcp_manager.py** / **global_mcp_state.py**：所有会话共享单一 `MCPHub` 与 `connected_servers`，新会话即时 MCP-ready 不再额外 spawn 子进程；启动时 `restore_from_last_session()` 后台重连上次连接的服务（持久化于 `~/.agenticx/mcp_state.json`），`list_mcps`/`mcp_call`/`connect`/`disconnect` 统一收敛于此（commit `83cdf536`/`ad4533e7`）。

### 用量计量与追问

- **usage_store.py** + **model_pricing.py**：每轮 LLM 用量写入 `~/.agenticx/usage.sqlite`（`usage_events` 表），`compute_cost_usd()` 按 1M tokens 估算成本，供 Studio `/api/usage/*` 聚合。
- **followup_stream.py**：从流式与最终文本剥离 `<followups>` 块，受 `runtime.suggested_questions.enabled` 控制，驱动 Desktop 追问 chips（要求第一人称视角，commit `dedfbcca`）。

### 凭据安全与品牌

- **prompts/credential_safety.py**：`CREDENTIAL_SAFETY_BLOCK` 注入 Meta-Agent / implement-role / subagent 系统提示，明确禁止在对话中索要/落盘任何密钥，改引导用户在「设置 → 模型服务 / MCP」本地配置（Plan `2026-05-26-near-credential-safety`）。
- Meta-Agent 与 IM 回复默认品牌切换为 **Near**（commit `9a3100bb`）。

### Hook 扩展

- **hooks/legacy_event_bridge_hook.py**：`LegacyEventBridgeHook` 把运行时生命周期/工具事件桥接到全局 hook 总线（`agent:start/stop`、`tool:before_call/after_call`），是 bundled `pre_tool_guard` 等声明式 hook 生效的接线点。
- **hooks/session_summary_hook.py**：`AGX_SESSION_SUMMARY` 开启时在会话结束生成摘要用于跨会话延续。

---

## 运行时配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `AGX_LLM_INVOKE_TIMEOUT_SECONDS` | 120 | LLM 首次响应超时 |
| `AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS` | 60 | 流式心跳超时 |
| `AGX_LLM_HARD_TIMEOUT_SECONDS` | 300 | 单次绝对上限 |
| `AGX_LLM_FIRST_FEEDBACK_SECONDS` | 8 | 等待时长触发 ⏳ |
| `AGX_MAX_TOOL_ROUNDS` | 30 | 子智能体最大工具轮数 |
| `AGX_STATUS_QUERY_BUDGET_PER_TURN` | 2 | 每轮 query_subagent_status 上限 |
| `AGX_STATUS_QUERY_COOLDOWN_SECONDS` | 8 | 状态查询冷却时间 |

---

## 模块导出接口

```python
from agenticx.runtime import (
    AgentRuntime,
    AgentTeamManager,
    SubAgentContext,
    SubAgentStatus,
    SpawnConfig,
    EventType,
    RuntimeEvent,
    ConfirmGate,
    AsyncConfirmGate,
    AutoApproveConfirmGate,
    HookRegistry,
    AgentHook,
    HookOutcome,
)
```

---

## 架构关系

```
Studio Server / Desktop
    ↓ EventEmitter
AgentTeamManager
    ↓ spawn_subagent → asyncio.Task
AgentRuntime.run_turn()
    ├─ ContextCompactor (history)
    ├─ HookRegistry (before/after model, tool)
    │    └─ MemoryHook (on_agent_end)
    ├─ LLM (stream_with_tools / invoke)
    ├─ LoopDetector (工具调用循环检测)
    ├─ ConfirmGate (高风险操作确认)
    ├─ dispatch_tool_async (STUDIO_TOOLS)
    └─ dispatch_meta_tool_async (spawn / cancel / status)
         └─ AgentTeamManager.spawn_subagent()
```

---

## 群聊 Workforce 桥接（2026-04-29 新增 + 2026-04-29 自动 dispatch 修订）

**Plan-Id**：`group-chat-workforce-bridge`
**ADR**：`docs/adr/0002-group-chat-workforce-bridge.md`

`GroupChatRouter.run_group_turn()` 增加两条 dispatch 路径：

1. **显式 routing="team"**（API 层保留，UI 不暴露）：直接调用 `_run_team_turn()`
2. **routing="intelligent" + 自动 dispatch**（默认，对用户透明）：当用户未 @ 任何成员且 `_is_complex_multistep_task(user_input)` 返回 True 且群聊有 ≥ 2 个 avatars 时，`_run_intelligent_turn` 在入口处自动 yield 给 `_run_team_turn()`

**自动 dispatch 启发式** (`_is_complex_multistep_task`)：
- 强信号词（任一命中即触发）：`步骤` / `第一步` / `第二步` / `拆分` / `分解` / `分步` / `并行`
- 顺序对（前后都命中即触发）：`先...后` / `先...再` / `1)...2)` / `1....2.` / `1、...2、` / `一...二`
- 弱信号词（≥ 20 字才触发）：`然后` / `接着` / `再` / `之后` / `先后` / `并且` / `同时` / `分别` / `逐步` / `调研` / `研究`

**设计原则**：宁可漏检（让复杂任务走 legacy intelligent，体验跟以前一样）也不要假阳性（把简单问题强行装饰成 Workforce，浪费 token）。

```
GroupChatRouter.run_group_turn(routing="team")
    │
    └─► _run_team_turn()
            │
            ├─ [规划层] WorkforcePattern.decompose_task()      ← AgentExecutor（纯 LLM 规划）
            │     └─ event_bus.publish(DECOMPOSE_START / DECOMPOSE_COMPLETE)
            │
            ├─ [规划层] CoordinatorAgent.assign_tasks()        ← AgentExecutor
            │     └─ event_bus.publish(TASK_ASSIGNED)
            │
            ├─ [执行层] _run_one_target() per subtask          ← AgentRuntime（全 Studio 能力）
            │     └─ event_bus.publish(TASK_STARTED / TASK_COMPLETED / TASK_FAILED)
            │
            └─ [汇总] _run_meta_project_manager_reply()        ← AgentRuntime
                  └─ event_bus.publish(WORKFORCE_STOPPED)
```

**关键组件**：
- `collaboration/workforce/WorkforcePattern`：规划层（decompose + assign）
- `collaboration/workforce/events.py:WorkforceEventBus`：事件总线（前端 SSE）
- `collaboration/task_lock.py:TaskLock`：项目级状态（Action Queue / 对话历史）
- Studio `GET /api/groups/{id}/events`：SSE 端点
- Studio `POST /api/groups/{id}/action`：UI 动作注入（ADD_TASK / PAUSE / RESUME / STOP）
- `cli/agent_tools.py`：新增 `task_experience_retrieve` / `task_experience_learn` / `task_experience_clear`
- Desktop `ChatPane.tsx`：`workforce.*` 事件分区渲染 + `sendGroupTeamAction`
- Desktop `AvatarSidebar.tsx`：routing 下拉增 `team` 选项

**强约束**：
- 4 种 legacy routing（intelligent / user-directed / meta-routed / round-robin）零修改、零回归
- 零新外部依赖
- `collaboration/workforce/` 内核完全不动（只在 group_router 写胶水）
- routing 默认仍为 `intelligent`（用户必须显式切换）

---

### TurnArchiveHook（2026-06-11）

**功能**：在 `on_agent_end` 异步将最近 user+assistant 配对块归档到 `WorkspaceMemoryStore.turns`；在 `on_compaction` 设置 `session._recall_boost_pending` 以提升下一轮 turn 召回 limit。

**注册**：`AgentRuntime.__init__` 中当 `memory.turn_archive.enabled=true` 时以 priority=-60 注册（`agenticx/runtime/hooks/turn_archive_hook.py`）。

**系统提示注入**：`meta_agent._build_memory_recall_context` 对 `source=turn` 条目加 `[历史对话] ` 前缀；压缩后 boost 时 `recall_turns_limit` 临时翻倍（上限 10）。
