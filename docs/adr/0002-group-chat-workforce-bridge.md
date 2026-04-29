# ADR 0002: 群聊路径桥接 Workforce 任务编排（混合执行栈方案）

## 状态

Accepted — 2026-04-29

---

## 背景

AgenticX 存在两条互不相通的多智能体执行路径：

| 路径 | 入口 | 执行栈 | 能力 |
|------|------|--------|------|
| **群聊路径** | `runtime/group_router.py:GroupChatRouter` | `AgentRuntime.run_turn()` | 流式 SSE / MCP / Studio 工具 / ConfirmGate / MemoryHook / LoopDetector |
| **Workforce 路径** | `collaboration/workforce/WorkforcePattern` | `AgentExecutor` (SDK 栈) | 任务分解 / Coordinator-Planner-Worker 架构 / WorkforceEventBus / Recovery |

用户在群聊中无法体验到任务编排（分解/分配/并发/Recovery），因为两条路径没有互通。

---

## 问题：直接桥接的不可行性

### 1. `CollaborationManager` 不支持 WORKFORCE 模式

`manager.py:_create_pattern_instance()` 的 `pattern_classes` 字典**不包含** `CollaborationMode.WORKFORCE`，直接调用 `manager.create_collaboration(pattern=CollaborationMode.WORKFORCE, ...)` 会抛 `ValueError`。

### 2. 两个执行栈不兼容

`WorkforcePattern.execute()` 内部创建 `AgentExecutor` 实例运行 Worker。`AgentExecutor` 是 SDK 风格的同步执行引擎：

- **无** 流式 SSE 输出（`AgentRuntime.run_turn()` 才有 `AsyncGenerator[RuntimeEvent]`）
- **无** Studio 工具集（`STUDIO_TOOLS`、MCP 服务器、`liteparse` 等）
- **无** `ConfirmGate`（高风险工具确认）
- **无** `MemoryHook`、`LoopDetector`、`ResourceMonitor` 等 Studio 生产保护

若在群聊路径中直接调用 `WorkforcePattern.execute()`，Worker 将以降级的 SDK 栈运行，**丢失全部 Studio 运行时能力**，不可接受。

---

## 决策：混合执行栈方案（Hybrid Stack）

**使用 WorkforcePattern 作为 *规划层*，使用 AgentRuntime 作为 *执行层*。**

### 方案描述

```
GroupChatRouter._run_team_turn()
    │
    ├─ [规划层] WorkforcePattern.decompose_task()          ← AgentExecutor / TaskPlannerAgent
    │      └─ 发布 DECOMPOSE_START / DECOMPOSE_COMPLETE 事件
    │
    ├─ [规划层] CoordinatorAgent 指定 subtask → avatar 映射  ← AgentExecutor
    │      └─ 发布 TASK_ASSIGNED 事件
    │
    └─ [执行层] 对每个 subtask 调用 _run_one_target()      ← AgentRuntime（全 Studio 能力）
           └─ 发布 TASK_STARTED / TASK_COMPLETED / TASK_FAILED 事件
```

### 规则

1. **规划层（decompose + assign）**：使用 `WorkforcePattern.decompose_task()` + `coordinator.assign_tasks()`（`AgentExecutor`）。这两步都是纯 LLM 规划调用，仅输出文本/JSON，不执行工具，不需要 Studio 能力。
2. **执行层（per-subtask 执行）**：保留现有 `_run_one_target()` → `AgentRuntime.run_turn()`，保证流式/MCP/ConfirmGate 完整可用。
3. **事件发布**：在关键节点手动发布 `WorkforceEvent`，驱动前端分区渲染（任务区/成员区/消息区）。
4. **TaskLock**：绑定 group session，接收前端 ADD_TASK / PAUSE / RESUME / STOP 操作。

---

## 拒绝的替代方案

### 方案 A：直接调用 WorkforcePattern.execute()

- 问题：AgentExecutor 执行栈丢失 Studio 运行时能力（MCP / 流式 / ConfirmGate）
- **拒绝**

### 方案 B：将 AgentRuntime 嵌入 WorkforcePattern.Worker

- 需要修改 `collaboration/workforce/worker.py`，违反"不动 collaboration 内核"约束
- 改动范围大，回滚成本高
- **拒绝**

### 方案 C：在 group_router 中完全重新实现 Workforce 逻辑

- 重复造轮子，违反复用原则
- 维护两套任务板逻辑
- **拒绝**

---

## 后果

### 正向

- 群聊用户看到结构化任务编排（分解/分配/完成），用上任务区/成员区 UI
- Worker 执行层保留全套 Studio 能力（MCP/流式/ConfirmGate/MemoryHook）
- 不动 `collaboration/workforce/` 内核，回滚零成本
- `WorkforceEventBus` 30+ 事件复用，前端分区渲染有完整语义

### 约束

- 规划层（decompose + assign）使用 `AgentExecutor`，其 LLM 配置来自 group session 的 provider/model，与 Studio 运行时一致（通过 `llm_factory` 传入）
- 规划层不能调用 Studio 工具（此设计正确：任务分解/分配不应执行 bash/file_write 等）
- 每个 subtask 的执行仍受 `AgentRuntime.max_tool_rounds` 约束

---

## 实施锚点

| 约束 | 数值 | 来源 |
|------|------|------|
| `MAX_WORKERS_PER_GROUP` | 5 | 与 jiuwenclaw 默认 teammates 数相当 |
| `MAX_DECOMPOSE_SUBTASKS` | 10 | 防止 TaskPlannerAgent 过度分解 |
| `routing` 默认值 | `intelligent` | 不破坏现有 group.yaml |
| `mention_hops` 默认值 | 2 | config.yaml `group_chat.mention_hops`（新增） |

---

## 关联

- Plan-Id: `group-chat-workforce-bridge`
- Plan-File: `.cursor/plans/2026-04-29-group-chat-workforce-bridge.plan.md`
- 研究来源: `research/codedeepresearch/jiuwenclaw/jiuwenclaw_proposal.md` (v2)
