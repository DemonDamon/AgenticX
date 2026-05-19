---
name: machi-task-stall-recovery
overview: Machi 长任务卡住/无响应时的执行态保真、停止键保活、三通道 stall 检测、换模型续跑与可选自动 nudge
todos:
  - id: p0-backend-execution-state-fidelity
    content: "P0: 后端 finally 区分 interrupted vs idle，让 LLM 超时/硬失败留下 execution_state=interrupted"
    status: completed
  - id: p0-execution-state-stop
    content: "P0: execution_state ∈ {running} 时输入区强制显示停止键（paused/interrupted/idle 不显示）"
    status: completed
  - id: p0-triple-channel-stall
    content: "P0: 三通道 stall 检测（SSE 静默 / 客户端断流后台仍跑 / idle 但无 final 收尾）统一渲染 StallRecoveryCard"
    status: completed
  - id: p0-resume-with-state
    content: "P0: resumeCurrentTask 先查 execution_state，区分 idle/running/interrupted/paused 再发对应续跑话术"
    status: completed
  - id: p0-switch-model-resume
    content: "P0: StallRecoveryCard 内嵌独立换模型小面板（不依赖底部 PaneModelPicker），选定后续跑"
    status: completed
  - id: p0-sticky-task-liveness
    content: "P0: StickyTaskBar 增加 liveness/silentSeconds props，避免 todo in_progress 假转圈"
    status: completed
  - id: p0-bg-complete-toast
    content: "P0: running→idle 变化时 toast + loadSessionMessages 增量回填（不覆盖 enriched）"
    status: completed
  - id: p1-auto-nudge-config
    content: "P1: config.yaml + 环境变量 + 设置 Automation 区暴露 stall_auto_nudge_*"
    status: completed
  - id: p1-auto-nudge-runtime
    content: "P1: 前端 stall 持续超阈值且仍 running 时复用 forwardAutoReply 自动 nudge（每 session 上限）"
    status: completed
  - id: p1-session-status-chip
    content: "P1: 输入区上方状态 chip（模型名 + 已静默 Ns + 当前工具）"
    status: completed
  - id: p2-chatview-parity
    content: "P2: ChatView.tsx 对齐 ChatPane stall/stop 策略（Lite 模式 parity）"
    status: completed
isProject: false
---

# Machi 长任务卡住恢复与心跳续跑

- **Plan-Id**: 2026-05-19-machi-task-stall-recovery
- **Owner**: Damon Li
- **Status**: Draft (v2，根据代码核查修订)
- **Last-Updated**: 2026-05-19
- **前置计划**:
  - `.cursor/plans/2026-04-16-agent-heartbeat-recovery.plan.md`（P0 部分已落地但未闭环）
  - `.cursor/plans/2026-05-18-long-task-display-and-resilience.plan.md`（StickyTaskBar 已落地）
  - `.cursor/plans/2026-05-18-long-task-recovery-gates.plan.md`（rate limit / paused 已落地）

---

## 问题背景（用户反馈）

在 Meta-Agent 或分身下，模型通过 `todo_write` 创建多步任务后，常见以下体验断层：

1. **任务进度卡**（`StickyTaskBar`）仍显示某步 `in_progress` 转圈，但对话区长时间无新输出。
2. **停止按钮消失**：SSE `fetch` 结束（网络抖动、客户端 abort、代理超时）后，`streaming=false`，输入区恢复为发送键，用户无法中断。
3. **无明确恢复入口**：偶发出现 `StallRecoveryCard`，但仅在 `isStreamingCurrentSession=true` 且 **120s** 无 SSE 时触发；SSE 已断则检测失效。
4. **无法征求换模型**：`resumeCurrentTask` 固定发续跑话术，不引导用户在 kimi 等慢模型卡住时切换 Provider/Model。
5. **需人工值守**：缺少「检测到 stall 后自动 nudge 一轮」的可配置机制。

### 典型复现场景

- 模型：`月之暗面/kimi-k2.6`
- 流程：`todo_write` → `bash_exec`（读源码）→ 长时间 think / 无 token → SSE 断开或前端认为流已结束
- UI：`StickyTaskBar` 第 2 项仍 in_progress，输入区无停止键，无黄色恢复卡片

---

## 现状盘点（代码事实）

| 能力 | 文件 / 行号 | 当前行为 | 缺口 |
|------|-------------|----------|------|
| 停止键 | `ChatPane.tsx:6410` + `streaming-stop-policy.ts` | `streaming \|\| runGuard \|\| hasDelegation` | 未读 `execution_state` |
| Stall 检测 | `ChatPane.tsx:3706` | 仅 SSE active + 120s 无事件 | SSE 结束即停止计时 |
| 恢复 | `resumeCurrentTask` `ChatPane.tsx:3762` | 固定 sendChat 一句 | 未查 execution_state；无换模型 |
| 后台完成 | `ChatPane.tsx:3728` | 非 streaming 时 poll idle | 无 toast；messages 未强制 reload |
| 后端 finally | `agenticx/studio/server.py:2178` | **finally 无条件** `set_execution_state(..., "idle")` | LLM 超时/硬失败后**也是 idle**，前端永远等不到 `interrupted` |
| 已支持 paused | `subagent_paused` SSE + `ChatPane.tsx:5244` | rate-limit / 触顶专属卡 | 本 plan 不重复，但需在状态枚举里**视同非 running** |
| 后端心跳 | `agent_runtime.py` | `tool_progress` 每 ~2s；LLM idle 60s 超时 | meta 路径已更新 ToolCallCard，但不延长「可停止」态 |
| 任务条 | `StickyTaskBar.tsx` | 读最后 todo_write 快照 | 不反映真实 execution / SSE 活性 |
| `forwardAutoReply` | `ChatPane.tsx:3566` | 支持 `suppressUserEcho + skipUserHistory` | 自动 nudge 应复用，不要直接 sendChat 当 user 气泡 |
| `PaneModelPicker` | `PaneModelPicker.tsx` | 仅 pill 触发器，**无 imperative open API** | 卡片内换模型不能依赖它 |
| max_tool_rounds 面板 | `SettingsPanel.tsx` | 已有 slider | 本 plan 不重复 |

---

## 目标

让用户在**不值守**的情况下也能感知长任务状态，并在卡住时有**可操作的恢复路径**（继续 / 换模型 / 中断 / 可选自动 nudge）。

## Non-Goals

- 不重构 `AgentRuntime.run_turn` 主循环或 compactor 算法。
- 不调整 `max_tool_rounds` 默认值（设置面板已有）。
- 不改群聊 `GroupChatRouter` / IM 渠道。
- 不实现 SSE 长连接自动重连订阅（P2 以后单独评估）；本 plan 以 **execution_state + 新 sendChat** 恢复为主。
- 不顺手改 `TodoUpdateCard` / 工具卡片折叠逻辑 / `subagent_paused` 已有渲染。

---

## Functional Requirements

### FR-0：后端 execution_state 保真（P0，必做前置）

> **关键背景**：核查 `agenticx/studio/server.py:2178` 发现 finally 区**无条件**写 `idle`，导致 LLM TimeoutError / hard timeout / provider 5xx 之后也是 `idle`。本 plan 下游所有「靠 `execution_state` 区分异常 vs 正常」的逻辑都依赖此点修复，**因此必须前置到 P0 第 1 步**。

**文件**: `agenticx/studio/server.py`, `agenticx/studio/session_manager.py`（可能补 helper），`tests/test_smoke_session_execution_state_interrupted.py`（新增）

- **FR-0.1** Meta 对话 SSE 流（`_produce_meta_events` 所在 endpoint）的 finally 区根据异常路径区分写入：
  - 正常结束（含 FINAL、用户主动 interrupt 已经由专门路径置 `interrupted` 的场景）→ `idle`
  - LLM `asyncio.TimeoutError` / `record_session_provider_hard_failure` 触发的 hard timeout / 未捕获异常 → `interrupted`
  - 实现方式：runtime 流出 `error` 事件时打 flag（如 `had_runtime_error: bool` / `had_llm_timeout: bool`），finally 区根据 flag 决定终态。
- **FR-0.2** 委派路径（`_run_delegation_in_avatar_session`）的 finally 同理；已有 `paused` 路径保留不动。
- **FR-0.3** `listSessions` API 中 `execution_state` 字段保持 `"idle" | "running" | "interrupted"`（paused 不进 session 行，沿用 `subagent_paused` SSE 已有渲染）。

**AC-0.1** 单测：mock LLM 抛 `asyncio.TimeoutError`，运行 `/api/chat` 一轮，断言会话 `execution_state === "interrupted"`。  
**AC-0.2** 用户正常获得 FINAL → `execution_state === "idle"`，不回归。  
**AC-0.3** 用户主动调 `/api/sessions/{sid}/interrupt` → `execution_state === "interrupted"`（既有行为不变）。

---

### FR-1：停止键与 execution_state 绑定（P0，依赖 FR-0）

**文件**: `desktop/src/components/ChatPane.tsx`, `desktop/src/utils/streaming-stop-policy.ts`

- **FR-1.1** Pane 维护 `sessionExecutionState: "idle" | "running" | "interrupted"`（paused 不进此字段；分身 paused 已由 `subagent_paused` 卡片表达）。
- **FR-1.2** 当 `sessionExecutionState === "running"` 且 `pane.sessionId` 匹配时，`ActionCircleButton.streaming=true`（显示停止键），即使 `canInterruptCurrentSession=false`。`paused / interrupted / idle` 均**不**显示停止键。
- **FR-1.3** `stopCurrentRun` 保持调用 `interruptSession(sessionId)` + abort 本地 fetch；调用后立即设 `runGuardSessionId`，poll 直到 `interrupted` 或 `idle`。
- **FR-1.4** 轮询合并：复用既有 `ChatPane.tsx:3728` 的 execution poll，避免双 timer。running 态 **2s**；非 running 停止该 session 的 poll。
- **FR-1.5** `streaming-stop-policy.ts` 新增 `shouldShowStopForExecutionState(state)` 纯函数，供单测与组件复用。

**AC-1.1** SSE `finally` 已将 `active=false`，但后端仍 `running` 时，输入区仍显示停止键。  
**AC-1.2** 用户点停止后，120s 内 `execution_state` 变为 `interrupted` 或 `idle`，停止键消失。  
**AC-1.3** 分身 paused（rate-limit / 触顶）后输入区**不**显示停止键，由既有 paused 卡承担恢复入口。

---

### FR-2：三通道 Stall 检测（P0，依赖 FR-0）

**文件**: `desktop/src/components/ChatPane.tsx`

引入统一状态机 `stallPhase: "none" | "stall" | "exhausted"`（paused 单独路径，不并入），三路触发：

| 通道 | 触发条件 | 阈值（初值） | 典型场景 |
|------|----------|-------------|----------|
| **A: SSE 静默** | `sessionStreamStateRef[sid].active === true` 且 `lastSseEventAt` 超阈 | **90s** | 模型 deep think，SSE 没断但无 token |
| **B: 客户端断流后台仍跑** | `execution_state === "running"` 且 SSE 不 active 且 `lastProgressAt` 超阈 | **90s** | 切窗格 / 网络抖动 abort fetch，但后端仍在跑 |
| **C: idle 但收尾不完整** | `execution_state === "idle"` 且 SSE 不 active 且 `messages.json` **最后一条不是 assistant FINAL**（如 user/tool 结尾） | **进入该 session 5s 内判断一次** | LLM 超时被 FR-0 标 interrupted 后兜底；或异常 idle |

- **FR-2.1** 任一通道满足 → `stallPhase = "stall"`，渲染现有 `StallRecoveryCard`。
- **FR-2.2** A/B 通道恢复（新 SSE / 新消息 / execution→idle 且有 final）→ 清除 stall；C 通道一次性判定，不再持续轮询。
- **FR-2.3** `exhausted` 路径保持现有「已达到最大工具调用轮数」识别，不回归。
- **FR-2.4** `lastProgressAt` 刷新源：`recordSseActivity`、`tool_progress`、`tool_result`、`messages.json` 长度增加（poll 比对 length + last id，**不**做全量 hash）。

**AC-2.1** 模拟 SSE 提前结束 + 后端仍 running 90s 无新消息 → 出现恢复卡片（通道 B）。  
**AC-2.2** 工具执行中每 2s 的 `tool_progress` 刷新 `lastProgressAt`，不误报 stall。  
**AC-2.3** kimi 长 think 触发 LLM hard timeout（FR-0 已写 interrupted）→ 前端立即出 stall 卡片（通道 C 兜底，因为 interrupted 也会触发 C 的「无 final 收尾」判定）。

---

### FR-3：恢复执行前先读 execution_state（P0）

**文件**: `desktop/src/components/ChatPane.tsx`

改造 `resumeCurrentTask`：

```ts
type ResumeMode = "same_model" | "switch_model";

async function resumeCurrentTask(mode: ResumeMode = "same_model") {
  const sid = pane.sessionId;
  const row = (await listSessions(...)).find((s) => s.session_id === sid);
  const state = row?.execution_state ?? "idle";

  if (state === "running") {
    // 不重复 sendChat，仅 toast「任务仍在执行中，可继续等待或主动中断」
    showToast("任务仍在后台执行中");
    return;
  }

  const prompt =
    state === "interrupted"
      ? "上一次任务被中断，请从未完成的 todo 项继续，并更新 todo_write 状态。"
      : "请汇报之前任务的执行结果；若文档或文件已生成请给出路径摘要；若仍有未完成项请继续。";

  setStallState("none");
  await sendChat(prompt);
}
```

- **FR-3.1** `running` 态点击恢复 → toast，不发请求。
- **FR-3.2** 恢复前 `setStallState("none")`，避免重复卡片闪现。
- **FR-3.3** paused 路径已有专属卡，**不**走 `resumeCurrentTask`，本 plan 不动。

**AC-3.1** idle 态点恢复 → 模型汇报结果而非盲目重跑。  
**AC-3.2** interrupted 态点恢复 → 模型接续 todo 第 N 步。  
**AC-3.3** running 态点恢复 → toast 提示「仍在执行中」，无重复请求。

---

### FR-4：换模型继续（P0，方案 B 内置小面板）

**文件**: `desktop/src/components/messages/StallRecoveryCard.tsx`, `desktop/src/components/ChatPane.tsx`

> **决策**：`PaneModelPicker` 没有 imperative open API。为避免新增跨组件耦合（store flag + useImperativeHandle），卡片**自带轻量换模型面板**，使用现有 `useAvailableModels` / `setPaneModelProvider` 等 hook。

- **FR-4.1** `StallRecoveryCard` 新增第三按钮：**换模型继续**（secondary 样式，位于「恢复执行」与「中断任务」之间）。
- **FR-4.2** 点击后在卡片底部展开内联选择面板：
  1. 列出当前 pane 可用 provider/model（复用 `getPaneModelOptions` 等已有数据源）
  2. 默认选中**与当前模型不同的同档替代**（如 kimi 卡住默认推荐 deepseek / glm-4.6 等，硬编码一个简短的「快速备选」白名单即可，避免一次性扫所有 provider）
  3. 用户确认后：`setPaneModelProvider(paneId, p)` + `setPaneModelName(paneId, m)` → 调用 `resumeCurrentTask("switch_model")`（话术与 FR-3 相同，由后端按新模型重跑）
- **FR-4.3** 卡片文案补充：`当前模型：{provider}/{model}。若长时间无响应，可尝试切换模型后继续。`
- **FR-4.4** 该面板**仅本卡片可见**，不污染底部 `PaneModelPicker` 与全局模型列表持久化逻辑（仅改 pane 模型，后续用户可在底部 pill 二次调整）。

**AC-4.1** stall 态下可完成「换模型 → 自动续跑一句」全流程，无需用户手动复制 prompt。  
**AC-4.2** 换模型仅影响当前 pane/session 后续请求（不污染其他窗格）。  
**AC-4.3** 不依赖 `PaneModelPicker` 暴露新 API，组件耦合最小。

---

### FR-5：StickyTaskBar 活性指示（P0）

**文件**: `desktop/src/components/StickyTaskBar.tsx`, `desktop/src/components/ChatPane.tsx`

- **FR-5.1** `StickyTaskBar` 新增可选 props：
  - `liveness?: "active" | "stalled" | "idle"`
  - `silentSeconds?: number`
  - `onResume?: () => void`
- **FR-5.2** `liveness === "stalled"` 时：
  - in_progress 项 spinner 保留 + 副标题「已 {N}s 无响应」（amber）
  - 标题行右侧可选「恢复」链接（调用 `onResume`，等价于点 StallRecoveryCard 的「恢复执行」）
- **FR-5.3** `ChatPane` 根据 FR-2 的 stall 状态传入 props；`allDone` 自动折叠逻辑不变。
- **FR-5.4** liveness 仅影响视觉，不修改 todo 数据结构（避免污染 `parseTodoMessage` 调用方）。

**AC-5.1** 用户截图场景下，任务条与 StallRecoveryCard 状态一致，不会「只有转圈没有任何解释」。  
**AC-5.2** 任务全部完成（`allDone`）后 stalled 副标题不显示。

---

### FR-6：后台完成通知（P0）

**文件**: `desktop/src/components/ChatPane.tsx`, 可选 `desktop/src/store.ts`（轻量 toast）

- **FR-6.1** 检测 `execution_state` 从 `running` → `idle`（且非用户主动 interrupt 的 500ms 内）：
  - 消息区插入一条 tool 系统消息：`后台任务已完成`（现有逻辑保留）
  - **新增** 输入区上方或消息列表底部 **toast**（3s 自动消失，主题 token）
- **FR-6.2** 触发 `loadSessionMessages(sid)` 并**增量** merge 到 pane：
  - 比对 disk last message id vs 内存最后条；只 append 缺失尾部
  - 不整段替换，避免覆盖流式 enriched 字段（toolStreamLines、suggestedQuestions 等）

**AC-6.1** 用户切走再回来，能看到新产出消息回填。  
**AC-6.2** 已 enriched 的 tool 卡片字段不被回填覆盖。

---

### FR-7：可配置自动 Nudge（P1）

**文件**: `~/.agenticx/config.yaml`, `agenticx/cli/config_manager.py`, `desktop/src/components/SettingsPanel.tsx`（Automation Tab）, `ChatPane.tsx`

配置项（默认值保守）：

```yaml
runtime:
  stall_auto_nudge_enabled: false      # 默认关，用户显式开启
  stall_auto_nudge_after_seconds: 120  # stall 持续多久自动 nudge
  stall_auto_nudge_max_per_session: 2  # 每 session 最多自动 nudge 次数
```

同时支持环境变量覆盖（与既有 `AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS` 风格一致）：

- `AGX_STALL_AUTO_NUDGE_ENABLED=1`
- `AGX_STALL_AUTO_NUDGE_AFTER_SECONDS=120`
- `AGX_STALL_AUTO_NUDGE_MAX_PER_SESSION=2`

- **FR-7.1** stall 态持续超过 `stall_auto_nudge_after_seconds` 且 `execution_state !== "idle"` → **复用 `forwardAutoReply`** 派发：
  - `suppressUserEcho: true`（不显示用户气泡）
  - `skipUserHistory: false`（写入 `chat_history` 让模型可见，配 prefix `[auto-nudge]` 便于追溯）
  - UI 同步插入一条 tool 消息：`🔔 自动续跑提醒（第 N/M 次）`
- **FR-7.2** 达到 `max_per_session` 后不再自动 nudge，`StallRecoveryCard` 文案追加「已自动续跑 M 次，请改为手动操作」。
- **FR-7.3** 设置面板 Automation Tab 增加：开关 + 秒数 slider（60–300）+ 最大次数 stepper（1–5）。

**AC-7.1** 开启后用户离开 2 分钟，任务仍 running → 自动收到一轮模型回复或工具进展，无需点击；UI 留下 nudge 痕迹。  
**AC-7.2** 关闭开关后行为与 P0 完全一致。  
**AC-7.3** 达到 max_per_session 后第 M+1 次 stall 不再 nudge，仅保留手动卡片。

---

### FR-8：输入区状态 Chip（P1）

**文件**: `desktop/src/components/ChatPane.tsx`（composer 上方，与 Context token chip 并列）

- 显示：`{model} · 运行中 · 静默 {N}s` 或 `{toolName} {elapsed}s`
- 数据来自：`streamingModel` + `lastProgressAt` + 最近 `tool_progress` 的 name/elapsed
- running 但无 SSE 时仍显示「后台运行中 · 静默 {N}s」

**AC-8.1** 长 bash 执行期间 chip 显示工具名与秒数。  
**AC-8.2** SSE 断 + 后端仍 running 时 chip 显示「后台运行中」（与 FR-1 停止键状态一致）。

---

### FR-9：ChatView parity（P2）

**文件**: `desktop/src/components/ChatView.tsx`

Lite 模式对齐 FR-1/FR-2/FR-4 最小子集（stop + stall card + 换模型续跑），避免 Pro/Lite 行为分裂。auto-nudge / chip 可选不下沉。

---

## 实施顺序

```
P0-0  FR-0 后端 finally 区分 interrupted vs idle + smoke test       ← 关键前置
      ↓ 验收：单测 LLM TimeoutError → interrupted
P0-1  FR-1 execution_state poll + 停止键保活
P0-2  FR-2 三通道 stall + 阈值常量提取（STALL_SSE_MS / STALL_RUNNING_MS）
P0-3  FR-3 resume 改造 + FR-4 StallRecoveryCard 内置换模型小面板
P0-4  FR-5 StickyTaskBar liveness + FR-6 toast/增量回填
      ↓ 验收：手动长任务 + 拔网线 30s + abort fetch + 切窗格
P1-1  FR-7 配置 + 环境变量 + 设置面板 + 自动 nudge（复用 forwardAutoReply）
P1-2  FR-8 状态 chip
P2    FR-9 ChatView parity
```

## 改动文件清单

| 阶段 | 文件 | 预估行数 |
|------|------|---------|
| P0 | `agenticx/studio/server.py`（finally 区分 + flag） | +60 |
| P0 | `tests/test_smoke_session_execution_state_interrupted.py`（新增） | +120 |
| P0 | `desktop/src/components/ChatPane.tsx` | +240 |
| P0 | `desktop/src/components/messages/StallRecoveryCard.tsx`（含换模型小面板） | +110 |
| P0 | `desktop/src/components/StickyTaskBar.tsx` | +50 |
| P0 | `desktop/src/utils/streaming-stop-policy.ts` + `*.test.ts` | +60 |
| P1 | `desktop/src/components/SettingsPanel.tsx` | +80 |
| P1 | `agenticx/cli/config_manager.py`（defaults + 环境变量） | +30 |
| P2 | `desktop/src/components/ChatView.tsx` | +90 |

**测试**（P0 必做）：

- `tests/test_smoke_session_execution_state_interrupted.py`（新增）：LLM 超时 → interrupted；正常 FINAL → idle。
- `desktop/src/utils/streaming-stop-policy.test.ts`（新增/扩展）：覆盖 `shouldShowStopForExecutionState`（running=true、idle/paused/interrupted=false）+ `canStopCurrentRun` 回归。

## 手动验收清单

1. Meta 会话：`todo_write` 5 步 + 触发长 think → 90s 内若 `execution_state=running` 应保留停止键。
2. **拔网线 30s 再连**（接近真实用户场景）→ 停止键仍在；90s 无新消息 → 黄色恢复卡片 + 任务条 stalled 文案。
3. DevTools abort 当前 `/api/chat` fetch → 通道 B 触发，60–90s 后出卡片。
4. kimi 长 think 自身超时（>60s）→ FR-0 标 interrupted，通道 C 立即兜底出卡片。
5. 点「恢复执行」→ 同模型按当前 execution_state 发对应话术；点「换模型继续」→ 内联小面板选定 → 自动续跑。
6. 点「中断任务」→ `interruptSession` + execution→interrupted/idle，停止键消失。
7. 后台跑完 → toast + 消息增量回填，已 enriched 工具卡未被覆盖。
8. 开启 auto nudge → 2min 无操作仍收到一轮 agent 响应；UI 留下 `🔔 自动续跑提醒` tool 消息。
9. 分身 paused（触发 rate limit）→ 不显示通用 stall 卡片，沿用既有 paused 渲染。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| ⚠️ **后端 finally 长期写 idle 覆盖 interrupted**（已识别） | FR-0 作为 P0 第一步落地；带 smoke 测试防回归 |
| 90s 阈值对 deep think 模型误报 | 工具 `tool_progress` 刷新 `lastProgressAt`；阈值提取常量，后续可 per-provider 加长 |
| execution poll 与现有 poll 重复 | 合并为单 timer，按 sessionId 去重（FR-1.4） |
| 自动 nudge 烧 token | 默认关闭；max 2 次/session；UI 显式告知 nudge 次数 |
| `loadSessionMessages` 覆盖 enriched message | FR-6.2 增量 append；比对 last id 而非整段替换 |
| 换模型续跑仍用同一 session 上下文 | 符合预期；prompt 含「先简要 summary 再行动」 |
| `StallRecoveryCard` 内置换模型面板增加包体 | 复用现有 `getPaneModelOptions` hook；不引入新依赖 |
| 通道 C 误判（`messages.json` 尾条非 FINAL 但实际任务无需 FINAL，如仅 tool 流） | 进入 session 5s 内只判一次，给 SSE 充分时间到达；仍误报时用户可手动忽略卡片 |
| FR-0 改后端可能影响群聊/委派的 finally | 群聊 SSE 由 `_group_chat_stream` 独立 finally，本 plan 不改；委派路径见 FR-0.2 |

## 与旧 Plan 关系

- **2026-04-16**：本 plan 吸收其 P0 意图并修正「仅 SSE active 才检测」缺陷；P1 max_tool_rounds 面板**已完成**，不再包含。
- **2026-05-18 系列**：StickyTaskBar / paused / rate limit 已落地；本 plan **只增强** StickyTaskBar 活性 + 修复后端 finally 覆盖 idle 的 bug，不改 compactor / file_write / paused 渲染链路。

---

## Commit 建议

按 P0（后端 + 前端）/ P0 前端补完 / P1 三段提交，每段独立 typecheck + smoke 绿后再推下一段。消息使用 `/commit --spec=.cursor/plans/2026-05-19-machi-task-stall-recovery.plan.md`：

1. `fix(studio): preserve interrupted execution_state on llm timeout / hard failure` (FR-0)
2. `fix(desktop): keep stop button and stall recovery aligned with execution_state` (FR-1~FR-6)
3. `feat(desktop): optional auto-nudge and composer liveness chip for long tasks` (FR-7~FR-8)

每 commit 附 `Plan-Id: 2026-05-19-machi-task-stall-recovery` 与 `Made-with: Damon Li`。
