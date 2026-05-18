# 长任务反馈透明化（修复"做着就断了 + 模型自解释会话被压缩"体验）

- Plan-Id: 2026-05-18-long-task-feedback-transparency
- Owner: Damon Li
- Status: Drafting

## Problem

用户反馈：在分身中执行长任务时，任务"做着就断了"，且没有任何反馈。追问模型为什么失败，模型回答"会话被压缩了"。但用户无法判断真实原因，体验极差。

经代码追踪，根因为 **3 个独立缺陷叠加**，并非"压缩本身导致终止"：

### 根因 1：分身触顶时 `SUBAGENT_PAUSED` 在委派路径被吞没（最严重）

`agenticx/runtime/agent_runtime.py:2344-2354` — 分身（非 meta）打满 `max_tool_rounds` 时只发 `SUBAGENT_PAUSED`，不发 `FINAL` / `ERROR`。

`agenticx/runtime/meta_tools.py:1652-1682`（`_run_delegation_in_avatar_session`）的事件消费循环只处理 `FINAL` / `ERROR`，对 `SUBAGENT_PAUSED` 视而不见 → `final_text=""` 且 `error_text=""` → 落到 `else: status = "completed"` → **触顶被伪装成"已完成"，Meta 完全感知不到**。

### 根因 2：`COMPACTION` 事件 Desktop 完全不渲染

后端 `agent_runtime.py:937-946` / `:1437-1452` 已发 `EventType.COMPACTION`，server 也透传成 SSE，但 `desktop/src/**` 全仓搜索 `compaction` 零命中。用户全程看不到压缩提示，必须靠模型事后解释。

### 根因 3：模型的"会话被压缩了"是**幻觉式自解释**

`compactor.maybe_compact` 仅替换消息列表，永不终止任务。模型说"会话被压缩了所以失败"是看到 `[compacted] 已压缩 N 条历史消息` 标记后的事后猜测，掩盖了真实失败原因（触顶/超时/budget exceeded 等）。

附加问题：
- `BudgetLevel.COMPRESS` 二次未降时（`agent_runtime.py:1454-1463`）只静默注入 `<budget_compress>` 系统消息，无用户可见提示。
- compactor 连续失败 3 次后熔断（`compactor.py:337-342`），用户毫无感知。

## Goals

让长任务的关键状态对用户**实时可见且不可被模型 fabricate**：触顶要明说触顶，压缩要 UI 提示，token 紧迫要直接告警。

## Non-Goals

- 不调整 `max_tool_rounds` 默认值（用户当前已 120，触顶反映的是反馈断层而非配额不足）。
- 不重构 compactor / token_budget 算法本身。
- 不改 group_chat / IM 渠道（仅本机 Desktop + 委派路径）。

## Requirements

### FR-1：委派消费循环正确处理 `SUBAGENT_PAUSED`

`agenticx/runtime/meta_tools.py:_run_delegation_in_avatar_session`：
- 在 `async for event in runtime.run_turn(...)` 循环中新增 `elif event.type == EventType.SUBAGENT_PAUSED.value` 分支，捕获 `text` / `round` / `max_rounds` / `executed_tools`。
- `status` 判定优先级调整为：`paused > failed > cancelled > completed`，新增 `status="paused"` 状态。
- `summary` / `error_text` / `result_text` 在 `paused` 状态下显式描述"达到 N/M 轮上限，已暂停。最近工具：X, Y, Z"。
- `_delegation_info` 持久化 `status="paused"`、`paused_round`、`max_rounds` 字段。
- `pending_subagent_summaries` 文案区分 paused 与 completed。
- `meta_team_manager._emit` 发 `SUBAGENT_PAUSED` 事件而非 `SUBAGENT_COMPLETED`。

### FR-2：Desktop 分身 pane 渲染暂停状态

Desktop 端 SSE handler 接收 `subagent_paused` 事件后：
- 在分身 pane 显示一条**暂停状态卡**："已暂停 · 触顶 N/M 轮 · 最近工具：…"
- 视觉与 `completed` / `error` 区分（建议橘黄/警示色，非红）。
- 不要把 paused 误标为 completed/failed。

### FR-3：Desktop 消费 `compaction` SSE 事件

Desktop 在 SSE 路由表里新增 `compaction` 处理：
- 在当前会话气泡流插入一条**轻量系统提示卡**：
  - 普通触发：「已压缩 N 条历史消息（保留最近 8 条 + 摘要）」
  - `reactive=true`：「⚠️ Token 接近上限，已压缩 N 条历史以释放上下文」（更显眼）
- 卡片样式与 `ToolCallCard` 同基准、可折叠、默认折叠。

### FR-4：`BudgetLevel.COMPRESS` 二次未降时发显式 WARNING 事件

`agent_runtime.py:1454-1463`：当压缩后仍处于 COMPRESS 状态，除了原本的内部 `<budget_compress>` 提示，**额外发** `EventType.ERROR` 但 `severity="warning"` 或新增独立类型，带 `detector="token_budget_compress"` + `current` / `max` 字段，让用户感知。

### FR-5：compactor 熔断后发 `compaction_skipped` 事件

`compactor.py:_consecutive_failures >= 3` 时 `maybe_compact` 返回不压缩。runtime 调用点新增检测：当 `_consecutive_failures` 跨过阈值时，发一次 `EventType.ERROR`（warning 级）："自动压缩已暂停（连续 3 次失败），长会话稳定性可能下降，建议新建会话或检查 LLM 连通性。"

### FR-6：分身 system prompt 添加防幻觉说明

`meta_tools.py:1599-1619` 的 `delegation_system_prompt` 追加：

```
## 上下文压缩说明
- 上下文中可能出现 [compacted] / [session_memory] / [user-pending-question] 等标记，这是历史摘要机制，**不代表任务被终止**。
- 如果你被中断或需要恢复，真实终止信号是显式的 [系统通知] 或 <runtime-stop>，不是 [compacted] 标记。
- 用户问"为什么失败/中断"时，不要凭空猜测"会话被压缩"，应基于真实错误信号或回答"无明确失败信号"。
```

同步检查 `agenticx/runtime/prompts/meta_agent.py` 是否需要类似补充（仅在含 [compacted] 注入路径时）。

## Acceptance Criteria

- **AC-1**：委派的分身打满 `max_tool_rounds` 时，Meta 主对话能看到"分身 X 已暂停（触顶 N/M 轮）"明确状态，而不是误判为"已完成"。（FR-1）
- **AC-2**：长任务发生压缩时，Desktop UI 实时出现压缩提示卡，用户无需追问模型即可知情。（FR-3）
- **AC-3**：用户追问"为什么失败"时，模型不再编造"会话被压缩"，而是基于真实事件（触顶/token 超限/超时）回答，或诚实回答"无明确失败信号"。（FR-6）
- **AC-4**：分身 pane 在 SSE 收到 `subagent_paused` 时显示明确暂停卡片（FR-2）。
- **AC-5**：Token budget 二次压缩仍未降时，用户能看到明确告警事件（FR-4）。
- **AC-6**：compactor 熔断后用户收到一次性提示（FR-5）。

## Implementation Steps

1. **plan 落盘 + 提交准备**（本步）
2. **后端 FR-1**：`meta_tools.py` 委派循环改造 + smoke test
3. **后端 FR-6**：`meta_tools.py` delegation prompt + meta_agent.py（如有）补充
4. **后端 FR-4**：`agent_runtime.py:1454-1463` 显式 WARNING
5. **后端 FR-5**：`compactor.py` + runtime 调用点接线 `compaction_skipped`
6. **前端 FR-3**：`desktop/src` SSE handler + 提示卡组件
7. **前端 FR-2**：Desktop 分身 pane subagent_paused 渲染
8. **冲烟测试**：FR-1 单元测试（mock SUBAGENT_PAUSED 事件流）
9. **commit**：按"后端先 / 前端后"分两个 commit，附 Plan-Id

## Risk

- FR-1 改 `_run_delegation_in_avatar_session` 状态判定时，需注意不要把已有 completed / failed 行为搞回归。冲烟测试覆盖三种状态 fork。
- FR-3/FR-2 的 SSE 事件名映射要在 `desktop/electron/main.ts` 或 server.py 里确认 SSE event name（`compaction` / `subagent_paused`）与 desktop store 派发匹配。

## Out-of-scope（按 no-scope-creep 显式记录）

- 不顺手优化 compactor 算法（pending_user_question 提取等）。
- 不调整 max_tool_rounds 默认值。
- 不改群聊路由 / IM 渠道。
- 不改 desktop 历史会话标题持久化等无关链路。
