---
name: stall-resume-and-action-button-fix
overview: 修复「停滞后点恢复执行/换模型继续多次无反应」与「停滞下三个点与复制按钮同时存在」两个互相耦合的体验 bug，思路是先强制中断 hung 住的旧请求再走 /continue，并把 desktop_manual 路径的 dedup/running 拦截放宽，同时让消息行的 action 按钮和会话级 stall/processing 状态保持一致。
todos:
  - id: server-manual-bypass
    content: server.py /continue 在 desktop_manual 下放宽 running+dedup 拦截，先 interrupt 再续跑
    status: completed
  - id: client-resume-force-interrupt
    content: ChatPane.resumeCurrentTask / resumeWithModel 不再因 running 直接 return，先 await interruptSession 再发 /continue
    status: completed
  - id: client-resume-inflight-state
    content: StallRecoveryCard 暴露 inFlight loading 态并禁用按钮，避免重复点击
    status: completed
  - id: visible-failure-feedback
    content: continuation_rejected 改为 inline 显示在 StallRecoveryCard 内，而不是 2.8s toast
    status: completed
  - id: action-button-suppression
    content: ImBubble assistantIconButtons 增加 sessionBusy/stalled 抑制条件，避免与三点 + 处理中文案语义冲突
    status: completed
  - id: resume-live-stream-on-reenter
    content: 回到 execution_state===running 的 session 时自动重连 SSE 续看实时输出，而非只读磁盘快照空等
    status: completed
  - id: smoke-tests
    content: 补 ptt-config 之外针对 session-continue 与 stall 抑制的 vitest
    status: completed
isProject: false
---

# Near 停滞恢复链路修复

## 背景与现象

用户在 stall 卡片上多次点击「恢复执行」「换模型继续」均无任何可见反应；最终切到 MiniMax-M2.7 后仍卡住，UI 同时出现「· · · 三个点 + 复制等 action 按钮 + 底部 处理中 · 静默 115s」三种语义冲突的状态。截图见会话附件。

## 根因（已 trace）

### Bug 1：恢复 / 换模型 多次没反应

链路：`StallRecoveryCard` → `ChatPane.resumeCurrentTask / resumeWithModel` → `POST /api/sessions/{id}/continue` → `prepare_continue`。

四道闸门叠加把请求悄悄吞掉：

1. `desktop/src/components/ChatPane.tsx:4332-4361` `resumeCurrentTask`：`listSessions` 看到 `execution_state === "running"` 直接 `setStallHintToast` 然后 return。
2. `agenticx/studio/server.py:2509-2518` `/continue`：`source == "desktop_manual" && exec_state == "running"` 时返回 `continuation_rejected`，前端 `ChatPane.tsx:5496-5500` 仅 toast。
3. `agenticx/studio/continuation.py:160-176` `should_dedupe_continue`：60s dedup 对 `desktop_manual` 同样生效，第二次点击命中 `续跑请求已去重`。
4. `desktop/src/components/ChatPane.tsx:4363-4374` `resumeWithModel`：只 `setPaneModel + setSessionModel + resumeCurrentTask`，**不 abort 当前 hung 住的请求**——LLM 不响应时 `execution_state` 永远是 `running`，1+2+3 必然命中。

且失败信号只有一个 2.8s 顶部 toast（`StallHintToast`），用户基本看不到，从而表现为「点了好几次没反应」。

### Bug 2：停滞下三个点 + 复制按钮共存

`desktop/src/components/messages/ImBubble.tsx:304-316` 中 `assistantIconButtons` 的可见条件只检查 `!isStreaming && !isMetaPendingWork && hasBody`，`isStreaming` 仅判断 `message.id === "__stream__"`。

stall 时上一轮已 commit 的 assistant 消息满足 `hasBody`，于是按钮立即出现；同会话下的 `__stream__` 占位（来自新触发的 sendChat / 自动续跑）渲染 `StreamingDots`；底部状态条又显示「处理中 · 静默 115s」。三种状态来自三个独立条件，未与 session 级 `stallState / sessionExecutionState / taskLiveness` 联动。

## 修复方案

### FR-1 服务端 /continue 在 desktop_manual 下宽容化（`agenticx/studio/server.py` + `agenticx/studio/continuation.py`）

- `source == "desktop_manual"` 时：
  - 不再因 `exec_state == "running"` 返回 `continuation_rejected`，而是先调用现有的 `manager.interrupt_session(sid)`（或等价路径），等 server 内部把 `execution_state` 翻到 `interrupted` / `idle`，再继续走 `prepare_continue`。
  - `prepare_continue` 增加 `skip_dedupe=True`（已有该参数，只需在 manual 路径透传），desktop_manual 不受 60s dedup 限制；保留 dedup 仅作用于 `desktop_auto_nudge` / `supervisor`。
- 仍保留 `desktop_auto_nudge` / `supervisor` 路径的 running 拦截，避免后台无限触发。
- 单元测试：`prepare_continue` 在 `source=desktop_manual` + `state=running` + 同 reason 60s 内重复时仍返回 `ok=True`。

### FR-2 客户端恢复路径强制 abort 旧请求（`desktop/src/components/ChatPane.tsx`）

- `resumeCurrentTask`：
  - 移除「listSessions 看到 running 就 toast 返回」的早退分支。
  - 改为：若当前 pane 有 in-flight `sessionAbortControllersRef[sid]` 或 `sessionStreamStateRef[sid].active`，先 `abortController.abort()` + `await window.agenticxDesktop.interruptSession(sid)`；server 有了 FR-1 后即便 race 也会走顺。
  - 然后 `setStallState("none")`、`sendChatRef.current("", { continuation: { reason, source: "desktop_manual" } })`。
- `resumeWithModel`：先 `setPaneModel + setSessionModel`（逻辑保留），再走 `resumeCurrentTask`（FR-2 已含 interrupt 逻辑），不再单独绕过。
- 复用现有 `stopCurrentRun` 中的 abort/interrupt 流程，但跳过它写入「⏹ 正在中断…」「已中断任务」这两条 user-facing 提示——续跑场景不希望出现「中断 + 续跑」两条噪音消息。提取为 `interruptForResume(sid)` 内部 helper。

### FR-3 卡片按钮 inFlight loading 态（`desktop/src/components/messages/StallRecoveryCard.tsx` + `ChatPane.tsx`）

- `StallRecoveryCard` 新增 `resumeInFlight?: boolean` prop；按下「恢复执行 / 确认并续跑 / 换模型继续」后立即置 true，按钮 `disabled` 且文案改为「恢复中…」「续跑中…」。
- `ChatPane` 用一个 `resumeInFlightRef` + state 包裹 FR-2 的异步流程；finally 在收到 `continuation_notice` 或 stream 第一帧后清掉，超时 8s 兜底也清。
- 同一 session 在 inFlight 期间忽略后续点击（防止用户「点了好几次」打出更多冗余 /continue）。

### FR-4 失败原因贴近卡片显示（`StallRecoveryCard.tsx` + `ChatPane.tsx`）

- `continuation_rejected` 不再仅 `setStallHintToast`，而是 setState `stallRejectReason`，由 `StallRecoveryCard` 在按钮区下方 inline 渲染「续跑被拒：xxx」（红色文案），下次成功后清空。
- toast 行为只在用户已经离开 pane 时兜底；同 pane 时主战场是卡片内 inline。

### FR-5 ImBubble action 按钮与 stall/processing 状态联动（`desktop/src/components/messages/ImBubble.tsx` + `MessageRenderer.tsx` + `ChatPane.tsx`）

- `ImBubble` 新增 prop `sessionBusy?: boolean`（语义：`taskLiveness !== "idle"` 或 `stallState !== "none"`）。
- `assistantIconButtons` 可见条件改为：
  ```
  !hideActions && !isUser && !isStreaming && !isGroupTyping && !isMetaPendingWork && hasBody
    && !(sessionBusy && isLastAssistantInPane)
  ```
  仅抑制「最末一条 assistant 消息」上的 action 按钮，历史消息仍可复制 / 重试，避免误伤。
- `MessageRenderer` / `ChatPane` 渲染最末 row 时显式传 `isLastAssistantInPane=true`、`sessionBusy=taskLiveness !== "idle" || stallState !== "none"`。
- 同时 stall 期：`__stream__` 占位的 `StreamingDots` 替换为带"已停滞 Ns"语义的静态图标（沿用 `StickyTaskBar` 已有 `AlertTriangle` 风格），消除"还在转 + 已经给按钮"的视觉错觉。
- 验证：`taskLiveness === "stalled"` 时最末 assistant 不显示按钮、不显示动态三点；`stallState === "none"` 且 `executionState === "idle"` 后按钮恢复。

### FR-7 回到运行中 session 时自动重连实时流（`desktop/src/components/ChatPane.tsx`）

**现象**：流式输出途中切到别的 session，前端会 abort 当前 SSE；后端 `agx serve` 仍在后台跑完，但尾部事件无人监听。切回来时前端只从磁盘 `messages.json` 重新拉历史 —— 跳走那一刻尚未 commit 的思考链/流式内容不在快照里，于是「回来空白」，要等后端把结果落盘 + 轮询拿到才补上（用户实测的几十秒空窗）。当前仅 `prevExecutionStateRef` 在 `running → idle` 转换时调 `mergeTailFromDisk`（`ChatPane.tsx:4167-4171`），**不覆盖「回来时仍 running」的活跃续看**。

- 在 pane `sessionId` 变更 / 窗格挂载的 effect 里，拉一次 `listSessions` 判定该 sid 的 `execution_state`：
  - 若 `=== "running"` 且本地 `sessionStreamStateRef[sid]?.active !== true`（即没有活跃的本地 SSE），调用一个新 helper `reattachStream(sid)`：建立只读 SSE 订阅（GET `/api/session/stream` 或现有续看端点，**不发新一轮 prompt**），把增量帧续接到 `sessionStreamStateRef[sid]` 与 `streamedAssistantText`，并刷新 `lastProgressAtRef` 避免误触停滞卡片。
  - 若 `=== "idle"`，仍走现有快照加载 + `mergeTailFromDisk`。
- `reattachStream` 复用现有 SSE 解析路径（与 `sendChat` 的 reader 逻辑共用 parser），仅区别在于不 POST 新消息、不写「🔁 续跑」类历史条目。
- 离开 pane（sessionId 切换 / 卸载）时照旧 abort，并清掉 `reattach` 的 controller，避免泄漏多条订阅。
- 若后端没有「纯订阅已运行 session 输出」的端点（需确认 `agenticx/studio/server.py` 是否暴露），FR-7 退化为：回到 running session 时显式提示「该任务仍在后台运行，完成后自动刷新」+ 缩短轮询间隔到 ~2s，保证尾巴尽快补齐；是否新增订阅端点作为该 FR 的子任务先 trace 再定。

### FR-6 测试

- `desktop/src/voice/...` 已有 vitest pattern；新增：
  - `desktop/src/utils/session-continue.test.ts`：mock fetch，验证 `desktop_manual` 续跑请求不会因为 dedup 被前端拦截、按钮 inFlight 态翻转。
  - `agenticx/studio/tests/test_continuation_manual_bypass.py`（或就近 smoke 文件）：覆盖 FR-1 的 manual + running 路径。
- `desktop/src/components/messages/ImBubble.test.tsx`：覆盖 FR-5 的可见性矩阵（4 状态 × 是否最末 assistant）。

## 验收

- AC-1：在 stall 卡片任意时机点「恢复执行」≤1 次，server 端 `execution_state` 必然在 1s 内落到 `interrupted/idle`，随后 `/continue` 成功，UI 收到 `continuation_notice` 并恢复流式输出。
- AC-2：「换模型继续」选中新模型后，新一轮请求由新模型承接（SSE `model_meta` / 顶栏 ModelBadge 与所选一致）。
- AC-3：`stallState === "stall"` 期间最末一条 assistant 消息不显示 复制 / 重试 / 引用 / 收藏 / 转发 按钮；恢复后立即出现。
- AC-4：连续 5 次点击「恢复执行」不会产出重复的 `🔁 手动续跑 · 原因：停滞` 历史条目（按钮在第 1 次点击后 disabled，且服务端 manual 路径自身去重保护）。
- AC-5：服务端拒绝（如 model 不可用、token 不足）时，原因字符串显示在 StallRecoveryCard 内，不依赖顶部 toast。
- AC-6：流式输出途中切走再切回同一仍 `running` 的 session，≤2s 内重新接上实时输出（继续看到增量帧），不再长时间空白干等；且不会因重连而误触「长时间无响应」停滞卡片。

## 范围与排除

- 修这两个 stall/按钮 bug + FR-7「回到运行中 session 自动续看实时流」；不动 `runtime.unattended.*` / `supervisor` 路径的语义、不动 `runtime.stall_auto_nudge_*` 默认值。
- FR-7 若需后端新增「纯订阅端点」，先 trace `agenticx/studio/server.py` 现有 SSE 能力再决定是否扩端点；优先复用现有路径，不为此重构 streaming 协议。
- 不调整 `StickyTaskBar` 现有「恢复」迷你按钮文案，仅复用其样式 token。
- 不动 `ChatView`（Lite 模式）等价代码路径——本轮先 Pro `ChatPane`，确认 OK 再镜像迁移。
