---
name: Meta-Agent Team Architecture
overview: 将 AgenticX Desktop 从单 Agent 串行模式升级为 Meta-Agent（CEO）+ Agent Team 多智能体协作架构，让主智能体始终可对话、子智能体并行执行、右侧面板实时展示进度。
todos: []
isProject: true
phases:
  - name: "Phase 1: 核心后端 — AgentTeamManager + SubAgent 隔离"
    todos:
      - id: p1-events-agent-id
        content: "修改 `agenticx/runtime/events.py`：`RuntimeEvent` 增加 `agent_id: str = \"meta\"` 字段，确保序列化时始终携带。同步更新 `EventType` 新增 `SUBAGENT_STARTED`, `SUBAGENT_PROGRESS`, `SUBAGENT_COMPLETED`, `SUBAGENT_ERROR` 四个枚举值。"
        status: pending
      - id: p1-subagent-context
        content: 新建 `agenticx/runtime/team_manager.py`：定义 `SubAgentContext` dataclass（agent_id, name, role, task, status, agent_messages, artifacts, context_files, confirm_gate, result_summary, created_at, updated_at）；定义 `SubAgentStatus` 枚举（PENDING, RUNNING, COMPLETED, FAILED, CANCELLED）。
        status: pending
      - id: p1-team-manager
        content: 在 `team_manager.py` 中实现 `AgentTeamManager` 类：spawn_subagent()（创建 SubAgentContext + 启动独立 AgentRuntime asyncio.Task，并发限制 max_concurrent=4）、cancel_subagent()（通过 should_stop 中断）、get_status()（返回所有 sub-agent 状态摘要）、_run_subagent()（内部方法，运行单个 sub-agent 的 run_turn 循环，收集事件并通过回调转发，完成后生成 result_summary）。
        status: pending
      - id: p1-resource-monitor
        content: 新建 `agenticx/runtime/resource_monitor.py`：`ResourceMonitor` 类，提供 `get_system_stats()` 返回 CPU%、内存%、活跃 sub-agent 数。`can_spawn()` 方法根据阈值判断是否允许新建 sub-agent。
        status: pending
      - id: p1-meta-tools
        content: 新建 `agenticx/runtime/meta_tools.py`：定义 Meta-Agent 专用工具：`spawn_subagent(name, role, task, tools?)` — 调用 TeamManager 创建子 agent 并返回 agent_id；`cancel_subagent(agent_id)` — 中断指定 sub-agent；`query_subagent_status(agent_id?)` — 查询进度；`check_resources()` — 返回当前资源状况和建议。工具定义遵循 STUDIO_TOOLS 相同的 dict schema。
        status: pending
      - id: p1-runtime-agent-id
        content: "修改 `agenticx/runtime/agent_runtime.py`：`run_turn` 新增 `agent_id: str = \"meta\"` 参数，所有 yield 的 `RuntimeEvent` 填充此 `agent_id`。不改变现有逻辑，仅传递标识。"
        status: pending
      - id: p1-confirm-isolation
        content: "修改 `agenticx/runtime/confirm.py` 和 `session_manager.py`：支持 per-agent confirm gate。`ManagedSession` 新增 `sub_confirm_gates: Dict[str, AsyncConfirmGate]`，`/api/confirm` 根据 `agent_id` 路由到对应 gate。"
        status: pending
      - id: p1-tests-backend
        content: 新增 `tests/test_team_manager.py`：测试 spawn/cancel/并发限制/资源检查/结果回收。新增 `tests/test_meta_tools.py`：测试三个 meta 工具的调用和返回格式。修改 `tests/test_agent_runtime.py`：验证事件携带 agent_id。
        status: pending
  - name: "Phase 2: Server 层 — SSE 多路合并 + Meta-Agent 会话管理"
    todos:
      - id: p2-session-team
        content: "修改 `agenticx/studio/session_manager.py`：`ManagedSession` 新增 `team_manager: Optional[AgentTeamManager]`（懒初始化）。新增方法 `get_or_create_team()` 返回 `AgentTeamManager` 实例。"
        status: pending
      - id: p2-server-multiplex
        content: 修改 `agenticx/studio/server.py`：`/api/chat` 的 `_event_stream` 支持多路事件合并。Meta-Agent 的 run_turn 事件 + sub-agent 通过 asyncio.Queue 转发的事件统一 yield，每个 SSE data 都含 `agent_id` 字段。
        status: pending
      - id: p2-confirm-route
        content: 修改 `/api/confirm` 端点：接受新增字段 `agent_id`（默认 `"meta"`），根据 agent_id 找到对应的 confirm_gate 提交确认。
        status: pending
      - id: p2-subagent-events
        content: 在 server SSE 流中新增 sub-agent 生命周期事件的转发：当 TeamManager 发出 SUBAGENT_STARTED/PROGRESS/COMPLETED/ERROR 时，通过合并 queue 推送给前端。
        status: pending
      - id: p2-meta-system-prompt
        content: 创建 Meta-Agent 专用 system prompt 模板（可放在 `agenticx/runtime/prompts/meta_agent.py`），包含：角色定义（CEO/调度者）、可用工具说明、任务拆解策略、进度汇报格式、资源感知指令。
        status: pending
      - id: p2-tests-server
        content: 修改 `tests/test_studio_server.py`：测试 SSE 事件含 agent_id、confirm 路由、多 agent 事件合并。
        status: pending
  - name: "Phase 3: 前端 — 侧边面板 + 多 Agent 消息路由"
    todos:
      - id: p3-store-model
        content: "修改 `desktop/src/store.ts`：Message 新增 `agentId?: string` 字段。新增 `SubAgent` 类型（id, name, role, status, task, progress?, currentAction?）。Store 新增 `subAgents: SubAgent[]`、`selectedSubAgent: string | null`、`addSubAgent`、`updateSubAgent`、`removeSubAgent` 方法。"
        status: pending
      - id: p3-chatview-meta-only
        content: 修改 `desktop/src/components/ChatView.tsx`：只渲染 `agentId === "meta" || agentId === undefined` 的消息。SSE 事件处理按 agent_id 路由：meta 事件更新聊天，sub-agent 事件更新 store 中对应 SubAgent 状态。
        status: pending
      - id: p3-subagent-panel
        content: 新建 `desktop/src/components/SubAgentPanel.tsx`：右侧可折叠面板（宽 280px~320px，动画展开/折叠），列出所有活跃 sub-agent 卡片。面板顶部有汇总状态（N running / N done / N pending）。
        status: pending
      - id: p3-subagent-card
        content: 新建 `desktop/src/components/SubAgentCard.tsx`：单个 sub-agent 的进度卡片。显示：名称、角色标签、状态图标（⏳/🔄/✅/❌）、当前动作（如 `正在写 main.py`）、进度条（可选）、[展开详情] 按钮显示最近 tool calls、[中断] 按钮（发 cancel 请求）。展开后显示该 sub-agent 的 tool_call/tool_result 事件列表。
        status: pending
      - id: p3-confirm-multi
        content: 修改 `desktop/src/components/ConfirmDialog.tsx`：confirm 弹窗增加来源标识（显示是哪个 sub-agent 请求确认）。提交时携带 `agent_id` 到 `/api/confirm`。
        status: pending
      - id: p3-layout-responsive
        content: 修改 `desktop/src/App.tsx` 或 `ChatView.tsx` 布局：当有活跃 sub-agent 时自动展开右侧面板（flex 布局：左侧聊天区 flex-1，右侧面板固定宽度）。无 sub-agent 时全宽聊天。窗口最小宽度调整为 680px（以容纳面板）。
        status: pending
      - id: p3-tests-frontend
        content: 验证前端 TypeScript 编译通过（`npm run build`）、无 lint 错误。手动验证侧面板展开/折叠、卡片状态更新、confirm 路由。
        status: pending
  - name: "Phase 4: Meta-Agent 智能调度 + 端到端验证"
    todos:
      - id: p4-meta-intelligence
        content: 完善 Meta-Agent system prompt：引导 LLM 在收到复杂任务时自动拆解、给出 sub-agent 分配建议、在用户问进度时调用 query_subagent_status。加入资源感知指令：spawn 前先 check_resources，根据返回决定并发数。
        status: pending
      - id: p4-result-summary
        content: 实现 sub-agent 完成后的摘要回传机制：TeamManager._run_subagent() 完成后提取最终回复 + 产出文件列表，压缩为 ≤500 token 摘要，注入 Meta-Agent 的 agent_messages 作为 tool_result。
        status: pending
      - id: p4-error-recovery
        content: 实现 sub-agent 失败后的恢复策略：TeamManager 捕获 sub-agent 异常，标记 FAILED，将错误摘要回传 Meta-Agent，由 Meta-Agent 决定重试或跳过。
        status: pending
      - id: p4-e2e-test
        content: 端到端验证：在 Desktop 中发送 `帮我创建一个深度调研助手`，验证：(1) Meta-Agent 拆解任务并 spawn sub-agents (2) 右侧面板显示 sub-agent 进度 (3) 用户在主聊天区问进度得到即时回复 (4) 可中断单个 sub-agent (5) 所有 sub-agent 完成后 Meta-Agent 汇总结果。
        status: pending
      - id: p4-docs
        content: 更新 `docs/cli.md` 增加 Agent Team 章节。更新 `desktop/README.md` 增加多智能体协作说明。
        status: pending
---


# Meta-Agent + Agent Team 多智能体协作架构

## 背景

当前 AgenticX Desktop 是单 Agent 串行执行：一旦进入工具调用循环，Agent 被"绑死"在子任务中，用户无法交互；长程任务 10 轮 tool call 后上下文溢出，任务必然失败。

## 目标架构

```
用户 ↔ Meta-Agent (CEO, 永不阻塞)
            ↕
      AgentTeamManager
      ┌─────┬─────┬─────┐
      │ SA1 │ SA2 │ SA3 │  (独立上下文, 独立 runtime)
      └─────┴─────┴─────┘
```

- **Meta-Agent**：只做意图理解、任务拆解、进度汇报、资源调度。自身上下文极轻（只保留决策日志 + 最新 sub-agent 摘要）
- **Sub-Agent**：独立 `AgentRuntime` 实例 + 独立上下文窗口 + 独立 confirm gate
- **事件流**：所有 `RuntimeEvent` 携带 `agent_id`，前端按 agent 分流渲染

## 关键设计决策

### D1: Meta-Agent 不执行工具
Meta-Agent 只有三类工具：
- `spawn_subagent(name, role, task, tools?, dependencies?)`
- `cancel_subagent(agent_id)`
- `query_subagent_status(agent_id?)`
其余 11 个 STUDIO_TOOLS（bash_exec, file_write 等）只分配给 sub-agent。
这保证 Meta-Agent **永不阻塞**，始终可响应用户。

### D2: Sub-Agent 上下文完全隔离
每个 sub-agent 拥有独立的 `SubAgentContext`:
- `agent_messages: list` — 独立对话历史
- `artifacts: dict` — 独立产物记录
- `context_files: dict` — 独立上下文文件
- `confirm_gate: AsyncConfirmGate` — 独立确认门

Sub-agent 完成后，仅将**摘要**（结果 + 产出文件列表）回传 Meta-Agent 上下文。

### D3: SSE 事件统一加 agent_id
`RuntimeEvent` 新增 `agent_id: str` 字段（`"meta"` 代表主 agent）。
前端按 `agent_id` 将事件路由到：
- `agent_id == "meta"` → 主聊天区
- 其他 → 右侧面板对应 sub-agent 卡片

### D4: 资源管控
`AgentTeamManager` 维护并发限制：
- `max_concurrent_subagents: int = 4`（可配置）
- 启动前检查系统资源（CPU、内存），拒绝或排队
- Meta-Agent 工具返回资源状态，LLM 自行决策

### D5: SSE vs WebSocket
本阶段继续使用 SSE（多路合并到单 SSE 流，按 agent_id 区分），避免协议切换带来的复杂度。未来可升级 WebSocket。

## 核心文件变更地图

**新增文件**:
- `agenticx/runtime/team_manager.py` — AgentTeamManager, SubAgentContext
- `agenticx/runtime/meta_tools.py` — spawn/cancel/query 三个 Meta-Agent 专用工具
- `agenticx/runtime/resource_monitor.py` — 系统资源检测
- `desktop/src/components/SubAgentPanel.tsx` — 右侧子智能体面板
- `desktop/src/components/SubAgentCard.tsx` — 单个子智能体卡片

**大改文件**:
- `agenticx/runtime/agent_runtime.py` — run_turn 支持 agent_id 传递
- `agenticx/studio/session_manager.py` — ManagedSession 支持多 runtime
- `agenticx/studio/server.py` — SSE 事件带 agent_id, 多路合并
- `desktop/src/store.ts` — Message 增加 agentId, 新增 subAgents state
- `desktop/src/components/ChatView.tsx` — 只渲染 meta agent 消息, 侧边面板联动

**中改文件**:
- `agenticx/runtime/events.py` — RuntimeEvent 增加 agent_id
- `agenticx/runtime/confirm.py` — per-agent confirm gate
- `agenticx/cli/agent_tools.py` — 工具注册区分 meta vs sub

## 风险与对策

- **并发安全**：sub-agent 完全隔离 context，通过 `TeamManager.report_result()` 串行回写 meta context
- **Confirm 冲突**：每个 sub-agent 独立 `AsyncConfirmGate`，前端根据 `agent_id` 路由确认弹窗
- **资源过载**：`max_concurrent_subagents` 硬限制 + 资源检测软限制
- **上下文膨胀**：sub-agent 结果只回传摘要（≤500 tokens），不回传完整 messages
- **MCP 并发**：MCP hub 维持共享但加异步锁

## 验证策略

- 单元测试：`TeamManager` 的 spawn/cancel/并发/资源限制
- 集成测试：Meta-Agent 通过 tool call 启动 sub-agent 并收集结果
- 前端测试：multi-agent 事件流渲染 + 侧面板更新
- 端到端：在 Desktop 中对话触发多 sub-agent 任务，验证进度可见 + 可中断 + 可交互
