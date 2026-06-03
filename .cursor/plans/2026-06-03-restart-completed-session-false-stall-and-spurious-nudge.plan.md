---
name: restart-completed-session-false-stall-and-spurious-nudge
overview: 修复「退出 app 重进后、点回一个早已完成的会话被误判为已停滞，并自动续跑污染会话」的生产级 bug。根因是桌面端 Channel C「最终回复」判定比后端 _last_turn_has_completed_reply 更严且只看数组最后一条，重启后进度时钟丢失叠加 idle 态允许自动续跑，导致已完成会话被误报停滞并自动续写。
todos:
  - id: channelc-final-reply-align
    content: Channel C 最终回复判定与后端对齐（扫最后一轮 user 之后是否有非空 assistant 正文，不只看最后一条；末尾标点不再算未完成）
    status: completed
  - id: suppress-autonudge-on-reentry-idle
    content: idle 态、刚进会话 grace 内/无 SSE/无 in-flight 的 Channel C stall 禁止自动续跑
    status: completed
  - id: smoke-tests
    content: vitest 覆盖「重启后重进已完成会话不报停滞/不自动续跑」与既有 stall 通道回归
    status: completed
isProject: false
---

# 重启后已完成会话误报停滞 + 误触自动续跑修复

> Plan-Id: 2026-06-03-restart-completed-session-false-stall-and-spurious-nudge
> Plan-File: `.cursor/plans/2026-06-03-restart-completed-session-false-stall-and-spurious-nudge.plan.md`
> 关联：`2026-05-29-stall-resume-and-action-button-fix`、`2026-06-02-merge-tail-stale-session-guard`、`2026-06-02-concurrent-session-stall-leak-fix`、`2026-06-03-minimax-reasoning-stall-and-kb-orphan-citation`（同族 stall 误报问题）

## 背景与现象

用户实测复现路径：
1. 某会话（如「费马大定理通俗解释」「AI Agent 平台技术实现需求」）此前已正常**完成**回答。
2. 退出 Near app（`agx serve` 随之重启），重进 app 后默认显示别的 session。
3. 点回这个已完成会话 → UI 显示「已停滞 / 该任务可能已中断」，并出现「自动续跑提醒（第 1/2 次）· 原因：停滞」。
4. 自动续跑发出 `/continue` 后，模型把它当成"上次中断的任务"续写（"上一次中断时停在 Phase 0-3，现在同步更新状态："），污染了已完成会话。

即：**任务并未真正中断**，是误报停滞 + 误触自动续跑。

## 根因（已 trace）

### 后端：完成判定宽松，重启后会把 running 纠正为 idle

`agenticx/studio/session_manager.py`：
- `scan_interrupted_sessions`（启动扫描，写盘）用 `_last_turn_has_completed_reply`（宽松：最后一轮 user 之后存在任意非空 assistant 正文即算完成）→ `running` 纠正为 `idle`。
- `_normalize_execution_state_for_listing` 对 `idle` 同样走 `_last_turn_has_completed_reply` → 返回 `idle`。

→ 后端这侧重启后大概率正确报 `idle`（完成）。

### 桌面端：Channel C「最终回复」判定更严且只看最后一条（核心 bug）

`desktop/src/utils/task-stall-policy.ts`：
- `messageLooksLikeAssistantFinal(lastMessage)` 仅检查**消息数组最后一条**：必须是 assistant、剥掉 `<think>` 后正文非空、且结尾不是 `：，；、—…`。
- `shouldTriggerIncompleteEndStall`：`execState === "idle"` 且 `!messageLooksLikeAssistantFinal(lastMsg)` → 触发 Channel C 停滞。

桌面与后端判定口径不一致，下列任一情形会让"已完成"被误判为"非最终回复"：
- 持久化后**最后一条是 `tool` 消息**（如 `knowledge_search` 结果排在末尾）；
- 该轮 assistant 几乎只有 `<think>` 思考、剥完正文为空；
- 正文结尾恰为冒号/省略号（截图那句以「：」结尾）。

`desktop/src/components/ChatPane.tsx` 停滞检测 effect：进入会话后 `lastProgressAtRef` 被重置为 `enteredAt`（重启后 `sessionProgressAtRef` 为空），grace ≥ `CHANNEL_C_GRACE_MS`(5s) 后 Channel C 命中 → `setStallState("stall")`。

### idle 态允许自动续跑 → 污染会话

`shouldAllowStallAutoNudge(stallState, executionState)`：`stallState === "stall"` 且 `executionState ∈ {running, interrupted, idle}` 即放行。**`idle` 也放行** → 一个根本没在运行的已完成会话被 Channel C 误判 stall 后，自动续跑发 `/continue`，模型无真实待办却续写，污染会话。

## 方案

### FR-1 Channel C「最终回复」判定与后端对齐（`desktop/src/utils/task-stall-policy.ts`）
- 新增 helper（如 `lastTurnHasCompletedAssistantReply(messages)`）：对齐后端 `_last_turn_has_completed_reply` 语义——**扫描最后一轮 user 之后是否存在任意非空 assistant 正文**（剥 `<think>` 后），而非只看数组最后一条；末尾标点 `：…，；、—` 不再单独判为"未完成"。
- `shouldTriggerIncompleteEndStall` 改为：`execState === "idle"` 且该会话**最后一轮没有任何已完成 assistant 正文**时才触发（保留对纯 tool 收尾 / 纯 reasoning / 空回复的真实未完成检测）。
- 不改 Channel A（SSE 静默）/ Channel B（running 静默）语义。

### FR-2 重进 idle 会话的 Channel C stall 禁止自动续跑（`task-stall-policy.ts` + `ChatPane.tsx`）
- `shouldAllowStallAutoNudge` 收紧：新增参数标识"本次 stall 是否来自 Channel C（idle + 看似未完成）且会话刚进入/无活跃 SSE/无 in-flight 请求"，此情形**不放行自动续跑**。
- 真正运行中（Channel A/B：`running` + SSE 静默或后端 running）的 stall 仍可按现有 `runtime.stall_auto_nudge_*` 自动续跑，语义不变。
- `ChatPane` 在调用 `shouldAllowStallAutoNudge` 处补传上述上下文（sseActive / grace / in-flight）。

### FR-3 测试（`desktop/src/utils/*.test.ts`）
- `task-stall-policy` 单测：
  - 最后一条是 tool 消息但上一轮有完整 assistant 正文 → `shouldTriggerIncompleteEndStall === false`。
  - assistant 正文以「：」结尾 → 不再判为未完成。
  - 纯 `<think>` 无正文 / 空回复 → 仍判为未完成（真实场景保留）。
  - `shouldAllowStallAutoNudge`：idle + Channel C 来源 + 刚进入会话 → false；running + SSE 静默 → true。
- 既有 Channel A/B 与 `concurrent-session-stall-leak-fix` 相关用例回归通过。

## 验收

- AC-1：退出 app 重进、点回一个已完成会话（含调用过 `knowledge_search`、正文以标点结尾、含 `<think>` 思考的情形），**不再**出现「已停滞 / 该任务可能已中断」。
- AC-2：上述场景**不再**自动触发「自动续跑（原因：停滞）」，已完成会话不被续写污染。
- AC-3：真实运行中卡住（SSE 长时间无 token / 后端 running 静默超阈值）仍正常报停滞并可按配置自动续跑（行为不回退）。
- AC-4：新增 vitest 与既有 stall 用例全绿。

## 范围与排除

- 仅收敛 Channel C 误报 + idle 误触自动续跑；**不动** Channel A/B 语义、不动 `runtime.stall_auto_nudge_*` 默认值、不动后端 `execution_state` 归一化逻辑（后端已正确）。
- 不动 `ChatView`（Lite 模式）等价路径，本轮先 Pro `ChatPane`，确认 OK 再镜像。
- 不引入新依赖。
