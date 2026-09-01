# AgenticX Runtime 模块总结

> 结论更新时间：2026-09-01（覆盖上一基线 `f3ba65001c29` 之后的变更）

## 目录路径

`agenticx/runtime/`

## 模块概述

Runtime 模块是 AgenticX Studio 的核心执行引擎，负责驱动 Meta-Agent 与子智能体的完整生命周期：LLM 调用、工具分发、流式输出、上下文压缩、循环检测、确认门控、Hook 扩展以及多智能体团队调度。所有对话轮次通过 `AgentRuntime.run_turn()` 以 AsyncGenerator 形式发射 `RuntimeEvent` 事件流，供上层（Studio Server / Desktop）订阅转换。

---

## 目录结构

```
agenticx/runtime/
├── __init__.py             # 导出核心类（含风险感知确认门控系列）
├── agent_runtime.py        # AgentRuntime 核心 LLM 驱动循环
├── team_manager.py         # AgentTeamManager 多子智能体调度
├── events.py               # EventType 枚举 + RuntimeEvent 数据类 + 图片内容块事件助手
├── hooks/
│   ├── __init__.py         # AgentHook / HookRegistry / HookOutcome
│   ├── memory_hook.py      # MemoryHook：on_agent_end 自动提取记忆
│   ├── legacy_event_bridge_hook.py  # 将运行时 hook 桥接到全局 hook 总线
│   └── session_summary_hook.py      # 跨会话延续的会话摘要（AGX_SESSION_SUMMARY）
├── prompts/
│   ├── meta_agent.py       # Meta-Agent 系统提示构建器（易变区块改走 session-context）
│   ├── code_mode.py        # code_dev harness 模式系统提示块（仓库骨架 + 已读文件）
│   ├── credential_safety.py # 共享凭据/密钥安全指令块
│   ├── session_context.py  # (NEW) <session-context> 尾部易变状态消息（前缀缓存友好）
│   ├── tool_discipline.py  # (NEW) 工具用法细则（随工具 description 走，可延迟加载）
│   └── current_time.py     # 系统提示日期块（按日稳定）+ 尾部精确时刻提醒
├── graph/                  # (NEW) Near Graph Runtime：WorkGraph 模型/存储/编译/调度/干预
│   ├── models.py           # GraphRun / GraphNode / GraphEdge / NodeKind / NodeStatus / EdgeKind
│   ├── store.py            # GraphRunStore：~/.agenticx/graph_runs 原子 JSON 持久化
│   ├── compiler.py         # compile_workforce_run：Workforce 子任务 → GraphRun
│   ├── scheduler.py        # execute_group_run：按 depends 边分波并行执行 DAG 节点
│   ├── intervene.py        # 图干预（node_inject/node_retract/edge_reassign/selection_rule/pause/resume/cancel_node）+ agent 投影
│   ├── social.py           # H2A/A2A presence 投影、MESSAGE 边、辩论过热 nudge
│   └── events.py           # graph.* SSE 事件类型与载荷构造
├── command_safety.py       # (NEW) shell 命令分段分类器（assess_command / SafetyVerdict）
├── command_sandbox.py      # (NEW) OS 级命令沙箱（macOS seatbelt / Linux bubblewrap / Windows ProcessContainer）
├── path_policy.py          # (NEW) permissions.path_rules glob 匹配（deny 全局优先）
├── compaction_journal.py   # (NEW) 压缩 start/end 记账 + 孤儿锁检测（锁最后释放）
├── interrupted_closers.py  # (NEW) 崩溃恢复时为悬空 tool_calls 合成「未开始/结果未知」收尾行
├── harden_flags.py         # (NEW) 长运行硬化特性开关（env > config.yaml > 默认值）
├── fresh_round_loop.py     # (NEW) 上下文复位循环：每轮全新子智能体 + 结构化交接报告
├── group_facts.py          # (NEW) 群聊执行事实只读聚合（回复/工具/图节点/产物文件）
├── compactor.py            # ContextCompactor：历史消息压缩（经 compaction_journal 记账）
├── confirm.py              # ConfirmGate / AsyncConfirmGate / RiskAwareAutoConfirmGate + 风险分级
├── auto_solve.py           # 自动求解辅助
├── loop_controller.py      # 循环控制
├── loop_detector.py        # LoopDetector：工具调用循环检测
├── meta_tools.py           # Meta-only 工具分发 + fresh_round_loop 门控 + 沙箱策略继承
├── resource_monitor.py     # ResourceMonitor：spawn 前资源检查
├── scratchpad.py           # Scratchpad 工具实现
├── todo_manager.py         # TodoManager：结构化 Todo 跟踪
├── group_router.py         # GroupChatRouter：群聊路由 + Workforce/Graph dispatch + 全员广播
├── stall_policy.py         # 停滞检测（与桌面 task-stall-policy 对齐）
├── session_mode.py         # 会话 harness 模式（code_dev / daily_office / feature_loop）
├── code_outline.py         # code_outline 工具的 AST/轻量纲要提取
├── code_read_cache.py      # 记录 file_read 范围到 scratchpad（code_dev）
├── followup_stream.py      # 从流式/最终文本剥离 <followups> 追问块
├── global_mcp_manager.py   # 进程级 MCP 单例（共享 MCPHub + connected_servers）
├── global_mcp_state.py     # 最近连接 MCP 服务名持久化（mcp_state.json）
├── tool_result_budget.py   # 工具结果上下文预算：归档 / 分类 / 衰减（含批量归档阈值）
├── token_budget.py         # token 预算治理与超限事件
├── usage_store.py          # LLM 用量落 ~/.agenticx/usage.sqlite（含 cache_stats 命中率聚合）
├── model_pricing.py        # 按 1M tokens 估算成本（config.yaml 可覆盖）
├── model_context_window.py # 模型上下文窗口表 + 1M 级强上下文判定（is_strong_context_model）
├── prompt_cache_policy.py  # 缓存断点策略 + 隐式前缀提供商旁路 + 前缀指纹落盘
├── provider_fallback.py    # 超时兜底切换 + 禁止兜底判定（附件路由锁 / 企业托管）
├── truncated_final.py      # 截断终答检测（finish_reason=length、未闭合 Markdown、路径截断）
├── widget_flow_guard.py    # 正文 ASCII 流程图检测与重写提示（每会话至多 1 次重试）
└── usage_metadata.py       # 用量元数据（Token SSE）+ 多厂商 cached/reasoning 归一化
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
2. 上下文压缩：`ContextCompactor.maybe_compact()` 触发历史消息摘要压缩（经 `compaction_journal` 记账）
3. LLM 调用：优先 `stream_with_tools()`（流式 token + tool_call_delta），回退 `invoke()`
4. 工具调用过滤：流式累积和非流式响应均过滤 tool_name 为空字符串或字面量 `"none"` 的无效条目（部分 provider 会产生此类帧），过滤时记录 warning 日志
5. 内联工具解析：从文本中提取 `<tool_code>` 格式的工具调用
6. 工具分发：meta-only 工具走 `meta_tools.dispatch_meta_tool_async()`，其余走 `dispatch_tool_async()`
7. 循环检测：`LoopDetector` 记录每轮工具调用，warning/critical 两级处理
8. 状态查询节流：`query_subagent_status` 每轮至多 1 次，跨轮需冷却 8s

**长运行硬化（harden_flags.py 门控）**：
- **上下文溢出重试**：LLM 报 `context_window` 类错误时，强制压缩历史后重试本轮（`AGX_OVERFLOW_RETRY` 默认开，`AGX_MAX_OVERFLOW_RETRIES` 默认 2、上限 5），并发射 `detector=context_overflow_compact_retry` 的 warning 事件
- **持久化失败收口**：`_persist_or_abort()` 在 LLM 请求与每个工具副作用前 flush 回合前缀；`AGX_PERSIST_FAIL_CLOSED=1` 时持久化失败直接中止本轮而不是带病继续
- **取消前缀落盘**：用户中途打断时，`_finalize_cancelled_prefix()` 把已流出的可见正文作为 assistant 消息提交进历史（`AGX_CANCELLED_PREFIX_FINALIZE` 默认开），避免「用户看到了、模型却没说过」
- **中断收尾**：崩溃恢复路径由 `interrupted_closers.close_interrupted_tool_calls()` 为悬空 tool_calls 合成「未开始 / 结果未知」tool 行（见下文「中断恢复」）
- **兜底切换收口**：`provider_fallback.fallback_forbidden_reason()` 对两类会话禁止超时后静默换厂商——附件路由锁住的会话（文档要求留在私有部署）与企业托管会话（`enterprise` provider，走哪个模型是管理员的决定）；探测本身出错也按禁止兜底处理

**模型适配**：
- `_chat_temperature_kwargs()` 经 `sampling_params.resolve_chat_temperature` 按厂商解析温度参数
- Kimi K3 注入 `reasoning_effort`；DeepSeek V4（1M 窗口）注入 thinking 参数并保证带 tool_calls 的 assistant 行携带 `reasoning_content`
- 1M 级端点（`model_context_window.is_strong_context_model`）抑制每轮 goal anchor 注入

**超时体系**：
- `AGX_LLM_INVOKE_TIMEOUT_SECONDS`：首次响应超时，默认 120s；volcengine/bailian 180s
- `AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS`：流式心跳超时，默认 60s
- `AGX_LLM_HARD_TIMEOUT_SECONDS`：单次调用绝对上限，默认 300s
- `AGX_LLM_FIRST_FEEDBACK_SECONDS`：等待超此时长后提示 ⏳，默认 8s

**发射的 EventType**：
`ROUND_START`, `TOKEN`, `CONTENT_BLOCK`, `TOOL_CALL`, `TOOL_RESULT`, `CONFIRM_REQUIRED`, `CONFIRM_RESPONSE`, `COMPACTION`, `SUBAGENT_CHECKPOINT`, `SUBAGENT_PAUSED`, `FINAL`, `ERROR`

其中 `CONTENT_BLOCK` 是图片内容块事件：`events.py` 的 `iter_content_block_start_events` / `iter_content_block_end_events` 在 `generate_image` / `show_images` 工具调用前后发射 start（generating 骨架，不含字节）/ end（ready / error / cancelled，带 path/url/alt）帧，供 Desktop 渲染气泡内联图片占位与结果。

**系统提示结构**（执行型 Agent）：
- 静态部分留在 system prompt：角色、回复语言、code_dev / project_state / widget 触发规则、安全确认规则
- 易变部分（Skills 摘要、artifacts、Todo、Scratchpad、context_files、MCP 工具上下文）由 `_build_agent_volatile_sections()` 经 `stash_volatile_sections()` 挂到 session，runtime 组消息时以 `<session-context>` 尾部 system 消息注入（见「会话上下文与前缀缓存」）
- 信息不足/需求含糊时，要求直接以文字回复追问用户，不调用工具

---

### AgentTeamManager（team_manager.py）

**功能**：管理多个并发子智能体的生命周期，支持 spawn / cancel / retry / send_message。

**关键数据结构**：
- `SubAgentContext`：子智能体状态快照，包含 agent_id、status、task、artifacts、recent_events、output_files、spawn_tree_path 等；`confirm_gate` 默认为 `RiskAwareAutoConfirmGate(unattended=True)`（低风险自动放行、受保护操作无人值守直接拒绝）；`inherit_parent_context=True` 控制是否继承父会话上下文
- `SubAgentStatus`：`pending | running | completed | failed | cancelled`
- `SpawnConfig`：`max_spawn_depth=2`、`max_children_per_agent=5`、`max_concurrent=8`、`run_timeout_seconds=600`
- `AgentTeamManager(..., confirm_gate_factory=...)`：可注入自定义确认门控工厂，默认生成 `RiskAwareAutoConfirmGate(unattended=True)`

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
ROUND_START, TOOL_CALL, TOOL_CALL_DELTA, TOOL_PROGRESS, TOOL_RESULT,
CONFIRM_REQUIRED, CONFIRM_RESPONSE,
CLARIFICATION_REQUIRED, CLARIFICATION_RESPONSE, CLARIFICATION_SUSPENDED,
TOKEN, CONTENT_BLOCK, FINAL, ERROR,
SUBAGENT_STARTED, SUBAGENT_PROGRESS, SUBAGENT_CHECKPOINT,
SUBAGENT_PAUSED, SUBAGENT_COMPLETED, SUBAGENT_ERROR,
COMPACTION, CONTEXT_STATS, ROUND_END, STALL
```

**RuntimeEvent**：`type: str`、`data: Dict[str, Any]`、`agent_id: str`（默认 `"meta"`）

**图片内容块助手**（events.py 后半部分）：
- `IMAGE_PRODUCING_TOOL_NAMES = {"generate_image", "show_images"}`；`parse_image_tool_result()` / `parse_image_gallery_result()` 解析工具返回的 JSON 图片载荷并清洗 URL
- `build_content_block_start_event()` / `build_content_block_end_event()` 构造 `CONTENT_BLOCK` 的 start/end 帧；`image_content_block_id()` 生成稳定的 `img-<tool_call_id>[-<index>]` 块 id

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
- Skills 摘要（来自 `get_all_skill_summaries()`，单条描述截断至 160 字符）
- MCP 服务器列表（已连接/未连接）
- Avatars 列表
- Todo 当前状态
- 安全与权限规则
- 引用挂载（`_reference_mounts_from_taskspaces` 读取默认 taskspace 下 `.agx-mounts.json`，提示用 `list_files(".")` 列挂载目录）
- 内联出图纪律（`_build_inline_photo_display_block`：web_search → web_fetch → show_images 直链出图，与 view_image 视觉能力解耦）
- 纯文本模型的图片兜底：`view_image` 不可用时改用 `analyze_image(target=..., question=...)`
- 分身身份更新规则（`AVATAR_IDENTITY_UPDATE_RULES`：必须调用 `update_self_identity` 落盘）

**易变状态外移**：`build_meta_agent_system_prompt(..., include_volatile=False)` 时，易变区块（`build_meta_agent_volatile_sections`）经 `stash_volatile_sections()` 挂到 session，由 runtime 以 `<session-context>` 尾部消息注入，不再占 system prompt 前缀（见「会话上下文与前缀缓存」）。

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

**fresh_round_loop 工具（harden flag 门控）**：

`META_AGENT_TOOLS` 新增 `fresh_round_loop(objective, workspace_dir, max_rounds?, round_timeout_seconds?)`：为超长任务启动「上下文复位循环」——每轮 spawn 一个**不继承父会话历史**的全新子智能体（`inherit_parent_context=False`），只传目标、工作目录与上一轮的结构化 JSON 交接报告（`status: continue|complete|blocked` + summary/evidence/next_steps/blocker，≤8000 字符）。默认 16 轮、硬上限 32 轮，单轮默认 1200s 墙钟。仅在 `AGX_FRESH_ROUND_LOOP` / `runtime.fresh_round_loop` 开启时出现于工具表并可调用——`visible_meta_agent_tools()` 负责按开关过滤会话可见工具集，dispatch 侧二次校验。

**委派沙箱策略继承**：

`inherit_session_sandbox_policy(source_session, avatar_session)` 在委派/分身会话创建时把父会话的 `command_permissions` 沙箱档位与 `path_rules` 拷贝到子会话；父会话缺省时快照进程级配置，保证子会话不会回落到比父级更宽的默认值。

---

### 确认门控（confirm.py）

- `ConfirmGate`：同步确认基类；新增可选钩子 `should_emit_prompt()`（是否应对用户弹出确认事件）、`is_service_mode()`、`resolve(request_id, approved)`（供 HTTP/SSE 适配器解析挂起请求）
- `AsyncConfirmGate`：异步确认，支持 await、`last_request` 记录最近一次请求
- `AutoApproveConfirmGate`：子智能体专用，自动通过所有确认请求
- `RiskAwareAutoConfirmGate`：风险感知自动门控——仅 `context.risk == "low"` 的请求自动放行；其余（`high` / `destructive` / `computer_use` / `non_whitelisted` / `policy` / 未知）属受保护集 `PROTECTED_CONFIRM_RISKS`，交互模式转交 delegate 弹确认，无人值守（`unattended=True`）直接拒绝并记 `decision=blocked_unattended`
- `normalize_confirm_risk()`：缺省/拼错的 risk 一律按受保护处理（fail-closed，新工具默认不会绕过确认）
- `protected_confirm_reason()`：返回一行中文理由（如「这条操作会删除或覆盖已有内容」），解释全自动模式下为何仍弹确认
- `is_global_auto_confirm_mode()`：显式 `run_mode` / `confirm_strategy` 优先，遗留 `permissions.mode` 仅作兜底
- `confirm_denial_note()`：区分「用户拒绝」「无人值守运行不批准受保护操作」「等待确认超时」三种拒绝来源

---

### ContextCompactor（compactor.py）

- `maybe_compact(history, *, force, model, session)`：历史消息超阈值时调用 LLM 生成摘要，返回压缩后的 messages + did_compact + summary + compacted_count
- 压缩全程经 `compaction_journal` 记账：先追加 `compaction/start` 并建 `compaction.lock`，完成后追加 `compaction/end`（outcome: summarized / nothing-to-compact / failed），**最后**才删锁——中途崩溃留下可检测的孤儿锁，`detect_orphan` 下次启动时接管并记 warning，不阻塞后续压缩

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

## 命令安全与 OS 沙箱（2026-09 新增）

确认 UI 不再是安全边界：默认模式下每个 shell 子进程都跑在 OS 沙箱里，只能写会话工作区根与私有临时目录。

- **command_safety.py**：把复合命令拆成简单命令逐段分类，全部安全才整体安全。`READ_ONLY_COMMANDS`（ls/cat/rg/jq/diff 等）不再打扰确认；`GUARDED_COMMANDS`（find/sed/awk/git/xargs/tar 等）按参数判定（`find . -delete` 会被拦）；`COMMAND_RISK_CATEGORIES` 把命令名映射到风险类别，`NEVER_AUTO_APPROVED_CATEGORIES`（destructive_filesystem / system_disruption / host_full_access / external_publish / dependency_change / arbitrary_code_execution）永不自动放行。入口 `assess_command()` 返回 `SafetyVerdict`；无法解析的形式（命令替换、进程替换、后台 `&`）按不可判定处理——宁可多问一次。被 `cli/agent_tools.py` 的 bash_exec 链路调用。
- **command_sandbox.py**：三档权限 `READ_ONLY` / `WORKSPACE_WRITE` / `DANGER_FULL_ACCESS`（`normalize_command_permissions`）。`build_command_sandbox_plan()` 生成完整启动计划（argv/env/可写根/可读根/deny 规则），后端按平台分派：macOS seatbelt、Linux bubblewrap、Windows ProcessContainer（mxc，schema `0.7.0-alpha`，`AGX_WINDOWS_SANDBOX_EXECUTABLE` 指定运行器）。macOS/Linux 读写双隔离（home 目录不可读，`cat ~/.ssh/id_rsa` 被拒）；Windows 暂无读隔离，`shell_read_isolation_for_host()` / `path_deny_enforcement_for_host()` 分开如实上报能力缺口，供 UI 措辞。调用方：`cli/agent_tools.py:_apply_command_sandbox`、`studio/server.py`、`project_state/verify.py`。
- **path_policy.py**：落地 `permissions.path_rules` 用户路径规则。deny 全局优先（任何命中即绝对拒绝，短路在确认门之前）；allow 是「跳过确认」的常设豁免，不能把工作区边界拆掉（`/**` 不会瓦解沙箱）。`normalize_path_rules()` 容忍手写坏规则（跳过而非炸掉执行路径），`match_path_rules()` 对 Windows 路径同时按原样与正斜杠形式匹配。

---

## 中断恢复与崩溃韧性（2026-09 新增）

- **interrupted_closers.py**：`close_interrupted_tool_calls(messages, dispatched_call_ids=)` 为恢复上下文里悬空的 assistant tool_calls 合成 tool 收尾行——已派发但未拿到结果的标「结果未知」（提示先只读核验外部状态再决定是否重做），未派发的标「未开始，可安全重调」。纯函数、不重复合成。由 `studio/session_manager.py` 恢复路径在 `_sanitize_context_messages` 之前调用（`AGX_INTERRUPTED_CLOSERS` 默认开）。
- **checkpoint.py**：恢复语义相应更新——`RESUME_SYSTEM_HINT` 改为告知模型「被中断轮次的工具调用已标注为未开始/结果未知」，不再说「已从上下文移除」。
- **file_state.py**：`FileStateTracker.refresh_from_disk()` 支持从磁盘字节刷新快照（读/写都刷新），`file_edit` 前 staleness 检查不再只认 file_read 记录。

---

## 会话上下文与前缀缓存（2026-09 新增）

system prompt 是前缀缓存的第一个字节：里面任何每轮都变的内容都会让其后的整段对话历史缓存作废。本波改动把易变状态整体搬到缓存边界下游。

- **prompts/session_context.py**：`build_session_context_message(blocks, deferred_tool_names=, include_clock=)` 把易变区块渲染成一条 `<session-context>` system 消息，追加在对话历史之后、当前用户消息之前（不写入 `session.agent_messages`）。`build_deferred_tools_manifest()` 只列被 ToolSearch 摘掉 schema 的工具名（至多 120 个），保证模型知道它们存在、直接调用即可触发自动加载。侧信道：`stash_volatile_sections()` / `pop_volatile_sections()` 把 prompt builder 攒好的区块挂在 session 上，runtime 取走即清空，不跨轮泄漏。
- **prompts/tool_discipline.py**：工具「用法细则」从 system prompt 搬到工具自己的 `description`（`SHOW_WIDGET_USAGE` / `QUERY_DATA_SOURCE_USAGE` / `SKILL_MANAGE_USAGE`）——触发规则留在 system prompt，格式/参数/坑随工具走，ToolSearch 延迟掉工具时细则一起消失。
- **prompts/current_time.py**：`build_current_time_block()` 只放按日稳定的日期块（system prompt 友好）；精确到秒的时刻由 `build_current_time_reminder()` 一行经 `<session-context>` 尾部注入。
- **prompt_cache_policy.py**：Kimi/Moonshot 等隐式前缀缓存提供商直接旁路显式断点标记（`cache_mode=implicit_prefix`）；`build_prefix_fingerprints()` 对 tools→system→messages 逐行算 sha256 指纹，`persist_prefix_fingerprints()` 追加到会话目录 `cache_prefix.jsonl`，让缓存未命中可事后 diff 定位是哪一行变了。
- **usage_metadata.py**：`extract_cached_reasoning()` 兼容多厂商 cached 字段别名（`cached_tokens` / `cache_read_input_tokens` / `cached_prompt_tokens` / `prompt_cache_hit_tokens` / `cache_read_tokens`）与 `input_tokens_details`；`normalize_stream_usage()` 把流式 usage 拍平成落账字段，修复流式场景 cached/reasoning 长期为 0。
- **usage_store.py**：新增只读 `cache_stats(since_ms/provider/session_id)` 聚合（请求数、input/cached tokens、缓存命中率、零命中请求数、最近一次命中率），供本地核验缓存表现。

---

## Near Graph Runtime（graph/，2026-09 新增）

WorkGraph 运行时：把 Workforce 规划产物编译成 DAG，按依赖分波并行执行，并支撑 God-View 投影与人工干预。

- **models.py**：`GraphRun`（run_id/session_id/group_id/nodes/edges/version/status）+ `GraphNode`（kind: agent/spawn/task/human/review；status: pending/ready/running/blocked/paused/done/failed/cancelled/skipped）+ `GraphEdge`（depends/message/artifact/delegate）。
- **store.py**：`GraphRunStore` 落 `~/.agenticx/graph_runs/<run_id>/run.json`（`AGX_GRAPH_RUNS_ROOT` 可覆盖），原子写 + version 自增；`get_default_store()` 进程级单例。
- **compiler.py**：`compile_workforce_run(session_id, group_id, subtasks, assignment_map)` 把 Workforce decompose/assign 结果编译成 GraphRun。
- **scheduler.py**：`execute_group_run(run, runner=, on_event=, max_parallel=4, should_stop=)` 按 depends 边分波并行执行 READY 节点，事件经 `on_event` 回调，支持中途停止。
- **intervene.py**：`apply_intervention()` 应用 P0 干预算子（`node_inject` / `node_retract` / `edge_reassign` / `selection_rule` / `pause` / `resume` / `cancel_node`），终态节点不可改派；`build_agent_projection()` 把 TASK 节点投影成 agent 中心视图；`consume_graph_directives()` / `effective_mention_hops()` 供运行中会话消费图指令。
- **social.py**：H2A/A2A God-View 投影——`ensure_presence_run()` 建/取 ephemeral presence run（含 `human` 节点与成员 presence 节点），`upsert_message_edge()` / `project_h2a_fanout()` 维护 MESSAGE 边；`maybe_debate_nudge()` 在 60s 窗口内 MESSAGE 边 ≥4 条时发一次「辩论过热」提示。
- **events.py**：`graph.*` 事件类型（run_created / node_updated / edge_updated / edge_removed / edge_flow / intervention_applied / run_status）与 `graph_event()` 载荷构造。
- **接线**：`group_router._run_team_turn()` 的执行层改为 `compile_workforce_run()` + `execute_group_run()`（Workforce 规划、AgentRuntime 逐节点执行的混合栈保留）；`group_facts._load_graph_status_by_agent()` 从最新 run 读节点状态。

---

## 群聊路由新行为（group_router.py，2026-09 修订）

- **全员广播**：用户显式要求「各自介绍 / 每个人都回答 / 全员发言」时走 `_run_broadcast_all_members()` 逐成员强制作答（禁 `__SKIP__`）；成员数 > 8 时先由 Meta 发确认（`_emit_broadcast_all_confirm`，回复「继续/全员」后执行，pending 存 scratchpad）。
- **开放提问优先 Meta 主答**：未 @ 任何人的「群里谁能…/哪位…」类开放问题由 Meta（Near）以项目经理身份直接给 1–3 句核心答案，必要时结尾指引「细节问 @某某」，不再静默路由给单一成员。
- **open_floor 闲聊动作**：`_analyze_intent` 新增 `open_floor` 动作——把话丢进群里、最多 `group_open_floor_max_speakers()`（默认 2、上限 3）名成员有机会开口也可跳过；`AGX_GROUP_OPEN_FLOOR=0` 可整体回滚到单发言人旧行为。意图识别与 Meta 回复的 token 预算分别由 `AGX_GROUP_INTENT_MAX_TOKENS`（默认 1500）/ `AGX_GROUP_META_REPLY_MAX_TOKENS`（默认 2000）控制。
- **执行证据门**：`_apply_execution_evidence_gate()` 结合 `group_facts.build_group_execution_facts()` 聚合的只读事实（成员回复数、工具调用数、图节点状态、taskspace 产物文件）校验「完成/已搜索」类声称；无执行痕迹时 `_append_zero_exec_fallback()` 追加兜底说明，避免「口头承诺当产出」。
- **进度/工具事件收敛**：`_should_enqueue_runtime_event()` / `_should_forward_progress()` 过滤噪音进度；工具步骤与详情经 `_runtime_event_to_tool_step()` / `_runtime_event_to_tool_detail()` 渲染为聚合卡片素材。
- **其他**：`GroupChatContext.append_user/append_agent` 支持 `attachments` 落历史；群成员本地会话经 `_bind_group_local_session()` / `_copy_group_member_runtime_flags()` 继承运行时开关；`resolve_studio_session_id()` 统一解析 base session id（图 run 绑定缺失时拒绝把 session_id 绑成 group_id）。

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
| `AGX_OVERFLOW_RETRY` | 1 | 上下文窗口溢出时压缩历史并重试本轮 |
| `AGX_MAX_OVERFLOW_RETRIES` | 2 | 单轮溢出重试上限（clamp 0..5） |
| `AGX_INTERRUPTED_CLOSERS` | 1 | 崩溃恢复时合成中断工具收尾行 |
| `AGX_PERSIST_FAIL_CLOSED` | 0 | 持久化失败时中止本轮（默认带病继续） |
| `AGX_CANCELLED_PREFIX_FINALIZE` | 1 | 打断时已流出前缀落盘进历史 |
| `AGX_FRESH_ROUND_LOOP` | 0 | 启用 fresh_round_loop 上下文复位循环工具 |
| `AGX_GROUP_OPEN_FLOOR` | 1 | 群聊 open_floor 闲聊动作（0 回滚单发言人） |
| `AGX_GROUP_OPEN_FLOOR_MAX_SPEAKERS` | 2 | open_floor 一轮最多开口人数（clamp 1..3） |
| `AGX_GROUP_INTENT_MAX_TOKENS` | 1500 | 群聊意图识别补全预算（clamp 280..8000） |
| `AGX_GROUP_META_REPLY_MAX_TOKENS` | 2000 | 群聊 Meta 主答补全预算（clamp 500..8000） |
| `AGX_GROUP_META_DIRECT_TOOLS` | 0 | 群聊 Meta 直答携带工具（opt-in） |
| `AGX_GRAPH_RUNS_ROOT` | `~/.agenticx/graph_runs` | GraphRun 快照根目录 |
| `AGX_WINDOWS_SANDBOX_EXECUTABLE` | （空） | Windows mxc 沙箱运行器路径 |

以上 harden/group 类开关均按 `harden_flags.py` 的「env > `config.yaml` > 默认值」顺序解析，解析失败回落默认、绝不抛异常。

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
    SyncConfirmGate,
    AsyncConfirmGate,
    AutoApproveConfirmGate,
    RiskAwareAutoConfirmGate,
    CONFIRM_RISK_LOW,
    PROTECTED_CONFIRM_RISKS,
    normalize_confirm_risk,
    is_protected_confirm,
    protected_confirm_reason,
    confirm_denial_note,
    HookRegistry,
    AgentHook,
    HookOutcome,
)
```

Graph Runtime 经子包导出：`from agenticx.runtime.graph import compile_workforce_run, execute_group_run, GraphRunStore, apply_intervention, ...`（完整名单见 `graph/__init__.py` 的 `__all__`）。

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
            ├─ [执行层] compile_workforce_run() → GraphRun     ← graph/compiler.py
            │     └─ execute_group_run() 按 depends 分波并行    ← graph/scheduler.py
            │          └─ _node_runner() per task node          ← AgentRuntime（全 Studio 能力）
            │
            └─ [汇总] _run_meta_project_manager_reply()        ← AgentRuntime
                  └─ event_bus.publish(WORKFORCE_STOPPED)
```

**关键组件**：
- `collaboration/workforce/WorkforcePattern`：规划层（decompose + assign）
- `collaboration/workforce/events.py:WorkforceEventBus`：事件总线（前端 SSE）
- `collaboration/task_lock.py:TaskLock`：项目级状态（Action Queue / 对话历史）
- `runtime/graph/`：执行层 WorkGraph（编译 → DAG 调度 → graph.* SSE 事件 → God-View 投影/干预）
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

**任务强引用**（2026-09 修订）：归档协程的 `asyncio.Task` 存入 `self._pending` 集合并以 `add_done_callback(self._pending.discard)` 释放——asyncio 对游离 task 只持弱引用，不留强引用可能在跑到一半时被 GC 静悄悄丢弃（测试侧表现为跨用例的 "Event loop is closed" unraisable 异常）。

---

### 输出治理（2026-09 修订）

- **widget_flow_guard.py**：检测正文里的 ASCII/文本流程图（箭头行、竖向箭头、box-drawing 字符、`+---+` 框），命中后由 `build_widget_flow_retry_hint()` 生成重写提示让模型改用 `show_widget` 重画；每会话至多重试 1 次（`WIDGET_FLOW_MAX_RETRIES_PER_SESSION=1`），重写期间向 SSE 发一次性的 `WIDGET_FLOW_DISCARD_NOTICE`（Desktop 不落盘该句）。检测器用围栏状态机拆分 prose 与代码块，避免把代码里的箭头误判成流程图。
- **truncated_final.py**：截断终答检测增强——厂商显式 `finish_reason`（`length` / `max_tokens` / `max_output_tokens` / `max_completion_tokens`）必续一次；新增未闭合 Markdown（奇数个 ``` 或 `**`）与路径中间截断（如 `补 T4/T`）启发式。
- **assistant_output.py**：`<followups>` 保留标签兼容 MiniMax 等模型的别名拼写（`followflows` / `follow-ups` / `follow_ups` / `followup`），统一归一为 `followups` 且不再把已知别名误判为非规范标签。
- **tool_search.py**：默认模式从 `off` 改为 `auto`；`CORE_ALWAYS_LOAD_TOOLS` 新增 `web_search` 与 `update_self_identity`（`show_widget` 移出延迟白名单）；模型直接调用未加载工具时自动 load 并提示下轮重试（`TOOL_AUTO_LOADED_TEMPLATE`，无需先调 `tool_search`）。
