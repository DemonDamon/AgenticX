---
name: incomplete-turn-state-truth-and-presentation
overview: 根治「最后一轮 assistant 只有 <think> 无可见正文（模型退化/被切）时，会话被落为 idle，但前端 Channel C 剥 think 后判未完成→报 stall，呈现为『处理中 · 静默 Ns + 该任务可能已中断』的假运行/卡住态」。本 plan 在 Plan B（completeness 计算口径）基础上，把口径接到 ①finalize 落盘 execution_state、②listing 重算、③前端呈现层去歧义，让前后端与 UI 三方对一个事实：该轮已结束、未产出回答、可重试。
todos:
  - id: p0-stall-reason-distinction
    content: ChatPane 计算并下传 stallReason（silent=运行中静默 / incomplete=已结束未产出），由 Channel A/B vs C 决定
    status: pending
  - id: p0-status-row-deambiguate
    content: 状态行（ChatPane:8198+）incomplete-stall 且非 running 时不显示「处理中」与「静默 Ns」，改中性「未完成」
    status: pending
  - id: p0-card-copy
    content: StallRecoveryCard 按 stallReason 区分文案：incomplete 显示「上一轮未产出回答，可重试或换模型继续」，silent 保留「长时间无响应」
    status: pending
  - id: tests
    content: 纯函数 stallReason 推导补单测（如可）；ReadLints 改动文件干净；AST 不涉及（后端未改）
    status: pending
isProject: false
---

# 未完成轮次的状态真相与呈现一致化（P0 后端落盘+前端呈现，P1 旧会话收敛）

**Plan-Id**: 2026-06-05-incomplete-turn-state-truth-and-presentation
**Plan-File**: `.cursor/plans/2026-06-05-incomplete-turn-state-truth-and-presentation.plan.md`
**Owner**: Damon Li
**Made-with**: Damon Li

> 关联：
> `2026-06-05-interrupted-turn-finalize-and-completeness-truth`（Plan B：新增 `_visible_assistant_body` / `_messages_last_turn_has_completed_reply` 计算口径，**本 plan 把该口径接到 finalize 落盘、listing 重算与前端呈现**）、
> `2026-06-03-restart-completed-session-false-stall-and-spurious-nudge`（前端 Channel C 对齐）、
> `2026-06-05-concurrent-stream-ref-clobber-fix`（Plan A：并发流式 ref，重复落盘归该域）。

---

## 现象（用户实测，2026-06-05，已取证）

会话 `c247a865-...` 与 `8b643ae6-...` 重启后切回：query+历史正常显示（前次空白修复已生效），但底部显示「彩讯/glm-5.1 · **处理中** · 静默 645s」+ 横幅「该任务可能已中断（长时间无响应）」。

取证：
- 两个 session 末条 assistant 均为 **think-only**：`</think>` 闭合在最末尾、其后无任何正文、无 `suggested_questions`、无 `</followups>`。`c247a865` 在 `<think>` 内退化为重复循环（"Let me look at the / I'll look at the Agenticx code" 重复几十遍，30705 字符）后被切断。
- 存储 `execution_state` = **idle**（不是 running）。
- `_messages_last_turn_has_completed_reply` = **False**（Plan B 口径：剥 think 后无可见正文）。
- 前端 `shouldTriggerIncompleteEndStall`（`desktop/src/utils/task-stall-policy.ts:214`）：`state==="idle"` + grace 到 + hydrated + `!lastTurnHasCompletedAssistantReply` → True → `stallState="stall"`。
- `ChatPane.tsx:8198-8208`：`stallState==="stall"` 渲染状态行；execState 非 running → 不显示「运行中」，但 `sessionWorkInProgress` 为真 → 显示「**处理中**」+「静默 645s」。

---

## 根因

**B-3（落盘口径）**：后端一轮结束若可见正文为空（只有 think）仍落 `execution_state=idle`，与"未完成"事实不符；`scan_interrupted_sessions` 只处理 `running`，旧 idle 会话永不被重算。

**B-4（呈现歧义）**：Channel C 命中后用「处理中 · 静默 Ns」+「可能已中断（长时间无响应）」呈现，措辞暗示"在跑/卡住"，真相是"已结束、未产出、可重试"。

> Plan B 只新增了**计算口径**（纯函数），未接到 ①finalize 落盘、②listing 重算、③前端呈现。本 plan 收口这三处。

---

## 修复方案

> **认知修正**：经核对前端耦合，`idle`（运行时已结束）与 Channel C（检测"末轮未产出可见回答"）是两个正交轴，后端落 idle 没错。`StallRecoveryCard`（恢复执行/换型继续）只在 `stallState==="stall"` 渲染，而 Channel C 只在 `execState==="idle"` 触发——若把状态改成 `interrupted`，恢复卡片会整个消失，反而更糟。故放弃"后端改 execution_state"方向（一度尝试已回退），真正且唯一的 bug 是**呈现层措辞**。

### FR-1（todo: p0-stall-reason-distinction）区分 stall 原因
`desktop/src/components/ChatPane.tsx` stall 检测 effect 已分别算出 `channelA/B/C`。新增 `stallReason` 状态：`channelA||channelB` → `"silent"`（运行中静默）；`channelC` → `"incomplete"`（已结束未产出）。随 `setStallState("stall")` 一并设置，清除时复位。

### FR-2（todo: p0-status-row-deambiguate）状态行去歧义
状态行（`ChatPane.tsx:8198+`）：`stallState==="stall"` 且 `stallReason==="incomplete"`（非 running）时不显示「处理中」，改中性「未完成」，且不渲染「静默 Ns」。`silent` 保持原「处理中 · 静默 Ns」。

### FR-3（todo: p0-card-copy）恢复卡片文案区分
`StallRecoveryCard.tsx` 新增可选 `reason?: "silent" | "incomplete"`：`incomplete` → 标题「上一轮未产出回答」+ 副文案「可重试或换模型继续」；`silent`（默认）保留原「该任务可能已中断（长时间无响应）」。操作与触发逻辑不变。

### 验证（todo: tests）
- 若 stallReason 推导可抽纯函数则补单测；desktop 无 vitest 环境时如实说明，不虚报。
- ReadLints：`ChatPane.tsx` / `StallRecoveryCard.tsx` 无 lint 错误。后端未改，无需 AST。

---

## 验收（AC）
- **AC-1（呈现一致）**：未产出回答的会话重启后显示中性「未完成」+「上一轮未产出回答，可重试或换模型继续」，不再有「处理中 · 静默 Ns」「长时间无响应」等"在跑/卡住"暗示。
- **AC-2（重试可用）**：恢复执行 / 换型继续 / 中断任务仍在并可点。
- **AC-3（不误伤运行中静默）**：真正运行中静默（Channel A/B）仍显示「处理中 · 静默 Ns」+「长时间无响应」。
- **AC-4（不误伤完成态）**：有可见正文 / SQ / followups 的会话不触发任何 stall 呈现。
- **AC-5（无后端回归）**：后端 `_resolve_chat_end_execution_state` / `_normalize_execution_state_for_listing` 保持原逻辑（本轮尝试已回退）。

---

## 范围与排除
- **本 plan**：`desktop/src/components/ChatPane.tsx`、`desktop/src/components/messages/StallRecoveryCard.tsx`（呈现文案/条件 + stallReason 下传）。
- **不改**：后端任何文件、`task-stall-policy.ts` 触发逻辑、SSE 协议、Plan B 纯函数。
- **不在本 plan**（另行处理）：
  - think 内退化循环的 `loop_detector` 拦截（单独 plan）。
  - `8b643ae6` index 17-20 重复落盘（Plan A 并发流式域）。
  - 「恢复执行」对 think-only 末轮的补答闭环验证（先人工验证再定）。

---

## 实现说明（已落地）
- 落地文件与关键改动：
  - `desktop/src/components/ChatPane.tsx`：新增 `stallReason` 状态（`"silent" | "incomplete"`，默认 silent）；stall 命中处按 `channelA||channelB → silent`、`channelC → incomplete` 设置；状态行（统计 chip）当 `stall + incomplete + 非 running` 时显示「未完成」替代「处理中」并抑制「静默 Ns」；`StallRecoveryCard kind="stall"` 传入 `reason={stallReason}`。
  - `desktop/src/components/messages/StallRecoveryCard.tsx`：新增可选 `reason` prop 与 `isIncomplete`；incomplete 标题「上一轮未产出回答」+ 副文案「可重试或换模型继续」，silent 保留原「该任务可能已中断（长时间无响应）」。
- 验证结果：ReadLints 对 4 个文件（含未改的后端 2 文件）无错误；后端 AST OK；确认 `_resolve_chat_end_execution_state` / `_normalize_execution_state_for_listing` 已完全回退（无残留 `_has_user_turn` 等）。
- 偏差说明：放弃原 FR-1/FR-2 后端方向（会使 Channel C 失效、恢复卡片消失），改为纯前端呈现层 + stallReason 区分。desktop 无 vitest 环境，未跑前端单测；以 lint + 人工验收为准。
