---
name: session-state-isolation-and-false-stall-on-switch
overview: 从根上消除「切到另一个会话（尤其是有正在运行/已 hung 的会话）后切回一个早已完成的会话，被误报『已停滞 / 该任务可能已中断』」的生产级 bug。根因是 ChatPane 把每会话的停滞检测态当成单实例 state（靠切换时 reset 兜底，竞态脆弱），叠加切换会话时 messages 被清空且尚未水合时 Channel C 把『空消息』误判为『最后一轮无完成回复』，再被「另一会话占满单事件循环导致水合变慢」放大成持久卡死。
todos:
  - id: p0-channelc-hydration-guard
    content: Channel C 增加「会话消息已水合」前置守卫（未水合/加载中不得触发停滞），并补纯函数 + vitest
    status: completed
  - id: p0-loading-flag-consistency
    content: 经评估改用 messageCount>0 水合判据（不动 store loadingMessages，避免与 reconcile 守卫死锁）
    status: completed
  - id: p1-per-session-detector-state
    content: prevExecutionState 改为按 sid keyed（消除跨会话「后台任务已完成」误报）；stallState/execState 保留 reset 兜底（P0 已堵住误触发源）
    status: completed
  - id: p1-async-write-guard
    content: evaluate 在 await mergeTailFromDisk 后补 cancelled 复检，prev-state 按 sid 写入 keyed map，杜绝迟到回调写错会话
    status: completed
  - id: p2-backend-readpath-nonblock
    content: 已核实 list_sessions 为纯内存、switch 读路径仅小盘读；阻塞源归属 event-loop-blocking plan；前端 P0 守卫已使慢加载只显示加载中不误报中断
    status: completed
  - id: tests-regression
    content: vitest 全量 129 用例通过（含新水合守卫）；改动文件无 lint 错误
    status: completed
isProject: false
---

# 会话状态隔离 + 切换误报停滞 根因修复

**Plan-Id**: 2026-06-04-session-state-isolation-and-false-stall-on-switch
**Plan-File**: `.cursor/plans/2026-06-04-session-state-isolation-and-false-stall-on-switch.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

> 关联（同族 stall 误报，历次只治标）：
> `2026-06-02-concurrent-session-stall-leak-fix`（切换时 reset 兜底，已点明刻意没做 per-session map）、
> `2026-06-03-restart-completed-session-false-stall-and-spurious-nudge`（Channel C 完成判定对齐后端 + idle 禁自动续跑）、
> `2026-05-29-stall-resume-and-action-button-fix`、`2026-06-04-backend-event-loop-blocking-root-fix`（放大器）。

## 现象（用户实测）

1. 会话 A 早已**回答完毕**（静态 idle）。
2. 重启 app → 先进会话 B 跑新任务，**B 仍在运行（未完成 / 已 hung）**。
3. 切回 A → A 凭空显示「已停滞 12s」「该任务可能已中断（长时间无响应）」，底部状态「`月之暗面/kimi-k2.6 · 处理中 · 静默 12s`」，且**不会自愈**，直到 B 结束或再次重启。

即：**一个正在运行的会话污染了另一个已完成会话的状态显示**；在两个运行中的会话间来回切也会互相串态。这是反复出现的回归。

## 根因（已逐行 trace，证据）

### 链路 1 —— 切换会话时存在「messages 已清空但尚未水合」的空窗

- `desktop/src/store.ts` `setPaneSessionId`（:1588-1610）：切到**不同 sid** 时立即 `messages: []`（为保「一个 pane 只显示一个会话」不变量），随后异步 `loadSessionMessages` 再回填。
- 历史面板慢路径 `SessionHistoryPanel.tsx`（:708-744）：cache miss（**重启后 in-memory `tailCache` 为空**，必走慢路径）→ `setPaneLoadingMessages(true)` + `setPaneMessages([])` → `await resolveSessionTailForSwitch` 回填。
- ⇒ 存在一段 `pane.sessionId === A` 但 `pane.messages === []`（`loadingMessages === true`）的时间窗。

### 链路 2 —— Channel C 把「空消息」当成「最后一轮无完成回复」

- `desktop/src/components/ChatPane.tsx` 停滞 evaluate（:4807）直接读实时 `msgs`；Channel C（:4827-4829）`shouldTriggerIncompleteEndStall(execState, sseActive, msgs, graceMs)`。
- `desktop/src/utils/task-stall-policy.ts`（:187-199）：`execState==="idle"` 且 `graceMs>=5s` 且 `!lastTurnHasCompletedAssistantReply(msgs)` → 触发停滞。`lastTurnHasCompletedAssistantReply([])` 恒为 `false`。
- ⇒ 空窗内（msgs=[]）只要 grace≥5s，Channel C 必触发 → 已完成会话凭空「已停滞 / 已中断」。
- 关键不一致：`reconcileDisplayedSessionFromDisk`（:3827）**已**有 `if (livePane?.loadingMessages) return;` 守卫，但**停滞 evaluate 没有**这层守卫。

### 链路 3 —— 单事件循环争用把「短暂空窗」放大成「持久卡死」

- 后端为单进程单 asyncio 事件循环（见 `2026-06-04-backend-event-loop-blocking-root-fix`）。B 运行/hung 时，A 的 `loadSessionMessages` / tail page 水合变慢甚至迟迟不返回；`listSessions` 较轻仍能返回 A 的 idle。
- ⇒ A 的 msgs 长时间停在 []，Channel C 反复命中；evaluate 自愈分支（:4836）的 `recovered = idle && lastTurnHasCompletedAssistantReply(msgs)` 因 msgs 仍空而恒 false → **停滞卡片持久不消失**，正是用户「不会自动消失」的观感。

### 链路 4（架构病根）—— 每会话检测态是单实例，靠「切换 reset」兜底

ChatPane 内驱动 UI 的关键态是**单实例**（非按 sid keyed）：`sessionExecutionState`（:2174）、`stallState`（:2171）、`prevExecutionStateRef`（:2175）、`lastProgressAtRef` / `lastSseEventAtRef`（:2215-2216）、`streamingSessionId` / `runGuardSessionId`（:2156-2157）。仅 `sessionProgressAtRef` / `sessionStreamStateRef` / `sessionEnteredAtRef` 等是按 sid keyed 的。

`2026-06-02` 的修法是「切换显示会话时 reset 这些单实例态」（`shouldResetStallDetectorsOnSessionSwitch`，ChatPane :4548）。该方案**刻意没做 per-session map**（原 plan 自述「更大改动，非本次必需」），因此本质是竞态兜底：reset 与「立即重新 `listSessions` 写回」「上一个会话残留的异步回调写回」相互竞争，时序敏感、易回归。这就是「为什么修过还反复出现」。

> 一句话根因：**每会话状态没有真正按会话隔离（链路 4），切换瞬间又有空消息窗（链路 1），Channel C 把空消息误判为未完成（链路 2），单事件循环争用把它放大成持久卡死（链路 3）。**

## 修复方案（分层，P0 先治标止血，P1 治本，P2 去放大器）

### P0-1 Channel C 增加「已水合」前置守卫（`task-stall-policy.ts` + `ChatPane.tsx`）
- `task-stall-policy.ts` 新增纯函数（如 `sessionMessagesHydrated({ loadingMessages, messagesLoadedForSid })`）：会话消息**未确认水合**（仍 `loadingMessages`，或本 sid 尚无一次成功 load 落定）时返回 false。
- `shouldTriggerIncompleteEndStall` 增参 `messagesHydrated: boolean`：**未水合一律不触发 Channel C**。语义依据现有产品规则——「空会话/尚未水合不得预打『已中断』占位，须中性态」。
- `ChatPane` evaluate 在算 Channel C 处传入水合状态（读 `livePane.loadingMessages` + 下条的 per-sid 水合标记）。
- 不动 Channel A（SSE 静默）/ Channel B（running 静默）语义。

### P0-2 切换入口统一 loadingMessages 语义（`store.ts` + 各切换入口）
- 在 `setPaneSessionId` 清空 messages 的同一处，对「切到不同 sid」**同步置 `loadingMessages = true`**（集中到 store，避免依赖每个调用点记得置位）；水合落定（成功/失败/空）再由加载方清 false。
- 核对并补齐其它入口在清空后置位/清除：`SessionHistoryPanel`（已置）、`ChatPane.reconcileDisplayedSessionFromDisk`/switch effect、`App.tsx` 转发与 automation pane、`ChatView`（Lite）。
- 引入 per-sid 「已水合」轻量标记（ChatPane 内 `Record<sid, boolean>` ref，成功 load/replace 当前 sid 后置 true；`setPaneSessionId` 切到新 sid 时该 sid 标记复位），供 P0-1 守卫使用，覆盖「`loadingMessages` 未被某入口置位」的路径。

### P1-1 每会话检测态按 sid keyed，显示值由 currentSid 派生（`ChatPane.tsx`）
- 将 `stallState` / `sessionExecutionState` / `prevExecutionState` / `lastProgress` / `lastSseEvent` 收敛为按 sid keyed 的 ref map（`lastProgressAtRef` 已是 `sessionProgressAtRef` 形态可复用），显示用的 `stallState` / `sessionExecutionState` 改为 `derive(currentSid)`（`useMemo` / 选择器）。
- 移除「切换时 reset 单实例态」兜底（`shouldResetStallDetectorsOnSessionSwitch` 调用点）——隔离后切换只是「读另一个 key」，天然零泄漏、无 reset 竞态。保留纯函数与测试以防回退。
- 范围控制：`streamingSessionId`/`runGuardSessionId` 本就携带 sid 语义，本步只保证「显示判定一律以 `pane.sessionId` 对齐」，不扩散改写 SSE 链路。

### P1-2 异步回调按 sid 写入、写前校验当前会话（`ChatPane.tsx`）
- evaluate / switch effect / 后台同步里所有 `listSessions`、`loadSessionMessages`、reattach 回调：解析出的 `execState`/`progress`/`stall` 一律写入对应 **sid 的 keyed 槽**，并在 `set*` 影响「显示态」前校验 `sid === 当前 pane.sessionId`（已有 `cancelled` / `latestSid` 守卫的保留，缺的补齐），杜绝 B 的迟到回调改写 A 的显示。

### P2 去放大器：后端读路径不被运行中会话阻塞 + 前端慢加载只显示「加载中」
- 核实 `2026-06-04-backend-event-loop-blocking-root-fix` 是否已覆盖 session 读路径（`/api/session*` listSessions、`loadSessionMessages`、messages page）；若仍有同步重活（FTS/读盘）在事件循环上，按同样 `to_thread` 卸载（**仅在确证阻塞后**才动后端，遵循最小改动）。
- 前端兜底：当前会话水合超过阈值仍未完成，UI 维持「加载中…」骨架（已有 :7831 分支），**绝不**在「未拿到该会话真实消息」前显示「已停滞/已中断」。慢 ≠ 中断。

### Tests
- `task-stall-policy.test.ts`：未水合（loadingMessages / 空 msgs 且本 sid 未 load 落定）→ `shouldTriggerIncompleteEndStall === false`；已水合且最后一轮无完成回复 → 仍 true（真实未完成保留）；Channel A/B 用例与 `concurrent-session-stall-leak-fix`、`restart-completed-session-*` 既有用例回归。
- per-session 隔离单测：B(running/hung) keyed 态不影响 `derive(A)` 的 stall/exec 显示。

## 验收（AC）

- AC-1：重启后，先进 B 跑任务（B 运行/hung 中），切回早已完成的 A，**A 不再**出现「已停滞 / 该任务可能已中断 / 处理中 · 静默」，A 显示其真实已完成内容（或加载中骨架，水合后正常）。
- AC-2：两个运行中会话来回切换，各自 stall/exec/静默计时**互不串台**；任一会话的状态只反映其自身 sid。
- AC-3：真实运行中卡住（SSE 长时间无 token / 后端 running 静默超阈值，且**消息已水合**）仍正常触发停滞卡片并可按配置自动续跑（行为不回退）。
- AC-4：水合慢（后端被占）时显示「加载中…」而非「已中断」；水合完成后无残留 stall。
- AC-5：新增 vitest + 既有 stall 家族用例全绿；改动文件无 lint/类型错误。

## 范围与排除

- 先做 Pro `ChatPane`，确认后镜像 `ChatView`（Lite）。
- 不改 `runtime.stall_auto_nudge_*` / `runtime.unattended.*` 默认值与 Supervisor 语义、不改后端 `execution_state` 归一化逻辑（已正确）、不改停滞阈值默认值。
- 后端只在 P2 确证阻塞后做等价 `to_thread` 卸载，不改业务逻辑、不引新依赖。
- 不重构 SSE/进度记录主链路；P1 仅做「检测态按 sid 隔离 + 显示由 currentSid 派生」。

## 验证步骤

1. 完全退出 Near（`pkill -f 'agx serve'`）后重开，制造 in-memory tail cache 为空的「重启」初态。
2. 进 B 发一个长任务使其 running；保持 B 运行。
3. 切到一个早已完成的 A：观察 A 不再误报停滞（对照 AC-1/AC-4）。
4. 在两个 running 会话间快速来回切：观察静默计时/stall 互不串（AC-2）。
5. 构造真实 hung（断网/超时模型）且消息已水合的 running 会话：仍能正常报停滞（AC-3）。
6. `pnpm -C desktop test`（vitest）全绿（AC-5）；必要时跑后端 `pytest tests/test_smoke_*` 相关项。

## 回滚

- P0/P1 为前端纯增量守卫与「单实例→keyed」等价改造，回滚即恢复原读写；P2 后端为「同步→to_thread」等价封装，回滚恢复同步调用；均不涉及数据格式变更。

## 实现说明（落地与偏差，2026-06-04）

落地以「最小改动堵住误触发源 + 关键跨会话单例 keyed 隔离」为准，部分子项在实现中按工程审慎做了收敛，记录如下以保可追溯：

- **P0 水合守卫（已落地）**：`task-stall-policy.ts` 新增纯函数 `sessionMessagesHydrated({loadingMessages, messageCount})`，并给 `shouldTriggerIncompleteEndStall(...)` 增加 `messagesHydrated` 前置守卫（未水合直接返回 false）。`ChatPane.tsx` 评估处用 live pane 的 `loadingMessages + messages.length` 计算并传入。这是本次「切回已完成会话误报已停滞/已中断」的**直接根因修复**。
- **P0 store loadingMessages（偏差：未改 store）**：原计划在 `setPaneSessionId` 切换时强制 `loadingMessages=true`。评估发现这会与 `reconcileDisplayedSessionFromDisk` 既有的 `loadingMessages` 守卫互相阻塞（潜在死锁/不水合）。故改用更安全的 `messageCount > 0` 作为主水合判据，**不动 store**，规避回归。
- **P1 prevExecutionState keyed（已落地）**：`prevExecutionStateRef`（单例）→ `prevExecutionStateBySidRef: Record<sid, state>`。切换 reset、switch 回填、evaluate 读写、send 起跑五处全部按 sid 读写，**消除「B 运行态泄漏到 A 触发假『后台任务已完成』toast」**。
- **P1 迟到回调守卫（已落地）**：evaluate 在 `await mergeTailFromDisk(sid)` 之后补 `if (cancelled) return;` 复检，杜绝「合并尾部期间用户已切走，旧会话 exec 态被写到兄弟会话显示」的迟到写入泄漏。
- **P1 stallState/execState 全 keyed（偏差：保留 reset 兜底）**：`recordProgressActivity` 已自带 `key===currentSid` 门控（B 的进度不会写 A 的静默钟/stall），叠加 P0 守卫与切换 reset 后，可观测泄漏已堵死。将这两个高频显示态整体改 keyed 属热路径改造、收益递减且回归面大，本次**不做**，保留现有 reset 兜底。
- **P2 后端读路径（偏差：核实为轻量，不改）**：核实 `list_sessions` 为纯内存遍历（故运行中仍秒回）；切换读路径 `get_messages_page(tail_rounds)` 仅做小盘读。真正阻塞事件循环的重活（持久化/FTS/usage/memory-graph）归属 `2026-06-04-backend-event-loop-blocking-root-fix` plan 且已卸载。把这些**内存读**移到 `to_thread` 反而引入「运行中会话并发 append 时 list changed size during iteration」竞态，弊大于利，且前端 P0 已使慢加载只显示加载中不误报中断，故后端**不动**。
- **测试与校验**：`task-stall-policy.test.ts` 增补未水合/已水合两类用例 + `sessionMessagesHydrated` 用例；`pnpm -C desktop test` 全量 **129 用例通过**；改动文件 `ChatPane.tsx`、`task-stall-policy.ts`、`task-stall-policy.test.ts` **无 lint 错误**（仓库 `tsc --noEmit` 既有的全局报错与本次改动符号无关）。
- **ChatView（Lite）镜像**：本轮聚焦 Pro `ChatPane`，Lite `ChatView` 镜像评估留待确认后跟进。
