---
name: concurrent-session-stall-leak-fix
overview: 修复「多并发 session 切换时，未完成（hung）session 的停滞计时与停滞卡片状态泄漏到已完成 session，导致已完成 session 凭空显示『已停滞 Ns / 该任务可能已中断』且无法自愈」的竞态 bug，思路是把 ChatPane 内的瞬时停滞检测态（静默计时 / stallState / prevExecutionState）在显示 session 切换时按 session 重置基线。
todos:
  - id: pure-helper
    content: task-stall-policy.ts 新增 shouldResetStallDetectorsOnSessionSwitch 纯函数并补 vitest
    status: completed
  - id: chatpane-reset-on-switch
    content: ChatPane 进入 session 的 effect 中，仅在 session 真正切换时同步重置 lastProgressAtRef/lastSseEventAtRef 基线、prevExecutionStateRef、stallState、stallRejectReason
    status: completed
  - id: verify
    content: vitest 通过（18/18）；改动文件无 lint/类型错误
    status: completed
isProject: false
---

# 并发 Session 停滞态泄漏修复

## 背景与现象

用户有两个并发 session（同一 `ChatPane` 下经历史面板切换显示）：
- Session A 已结束（含最终回答 + 推荐问）。
- Session B 仍在后台运行且已 hung（LLM 长时间无响应）。

操作：切到 B 看一眼 → 切回 A。结果 A 凭空显示「已停滞 148s」+「该任务可能已中断（长时间无响应）」停滞恢复卡片（截图 1/2），且不会自动消失。

## 根因（已 trace）

`ChatPane` 内驱动停滞 UI 的几个瞬时态**没有按 session 隔离、切换显示 session 时也不重置**：

1. `lastProgressAtRef`（`desktop/src/components/ChatPane.tsx:2173`，单一 ref）→ `silentSeconds`（:3957）直接读它。切到 A 时仍是 B 的旧时间戳，于是 A 显示 B 的 148s 静默。
2. `stallState`（:2128，单一 state）→ 在 B 上已被置为 `"stall"`，切到 A 时**未重置**，停滞卡片直接沿用。
3. `prevExecutionStateRef`（:2132，单一 ref）→ 切换时仍是 B 的 `"running"`，evaluate（:4514）比较 `prev==="running" && execState==="idle"` 时会对 A 误触「后台任务已完成」。
4. 自愈失效：evaluate 的 `if (stallState === "stall")` 分支（:4559）里 `progressOk = silentMs < threshold`，而 `silentMs` 用的是泄漏的 `lastProgressAtRef`（148s）→ `progressOk=false`，无法靠进展判定清除（仅靠 recovered 分支，时序竞态下不稳定）→ 表现为停滞卡片持久卡死。

这正是用户所说「两个 session 在一个竞态里，未完成 session 影响已完成 session」。

## 修复方案

### FR-1 纯函数 `shouldResetStallDetectorsOnSessionSwitch`（`desktop/src/utils/task-stall-policy.ts`）

- 入参 `prevSessionId` / `nextSessionId`，仅当 `next` 非空且 `prev !== next` 时返回 true。
- 用于把"是否为真实显示 session 切换"的判定独立、可测，避免 effect 因 useCallback 依赖重建而误触重置。

### FR-2 切换 session 时同步重置瞬时检测态（`desktop/src/components/ChatPane.tsx`）

- 在「进入 session」effect（当前 :4323）顶部用 `lastEnteredSessionRef` 跟踪上一次进入的 sid；仅当 `shouldResetStallDetectorsOnSessionSwitch(prev, sid)` 为真时执行：
  - `lastProgressAtRef.current = enteredAt`、`lastSseEventAtRef.current = enteredAt`（基线设为本次进入时刻，而非 0 —— 既消除泄漏的旧静默，又让真正 hung 的 running session 仍能从"重新进入时刻"起算并按阈值正常触发停滞）。
  - `prevExecutionStateRef.current = "idle"`（随后 `listSessions` 会校正为真实态，消除对 A 的「后台任务已完成」误判）。
  - `setStallState("none")`、`setStallRejectReason("")`、`setStallTick((t)=>t+1)`。
- 该 effect 早于停滞 evaluate effect（:4494）定义，passive effect 按定义顺序执行，故重置的同步部分先于 evaluate 的同步首跑生效。

## 验收

- AC-1：A 已结束（含推荐问），切到仍在 hung 的 B 再切回 A，A 不出现「已停滞 Ns / 该任务可能已中断」卡片；`silentSeconds` 从重新进入时刻起算（≈0）。
- AC-2：切回 A 不再注入「后台任务已完成」噪音消息。
- AC-3：真正 hung 的 running session（重新进入后仍无 SSE）在静默超阈值后仍能正常触发停滞卡片（不被本次重置永久抑制）。
- AC-4：同一 session 内 running→idle 的正常「后台任务已完成」通知不受影响（重置只在显示 session 切换时发生）。

## 范围与排除

- 仅修 ChatPane（Pro）的瞬时停滞态泄漏；不动 `ChatView`（Lite）、不动 `runtime.unattended.*` / `supervisor` / 自动续跑语义、不改停滞阈值默认值。
- 不重构 SSE/进度记录链路，不把 `lastProgressAtRef` 全量改造为 per-session map（更大改动，非本次必需）。
