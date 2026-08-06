# Portal Chat Stream Maximum Update Depth Fix

Planned-with: cursor-grok-4.5  
Suggested-Impl-Model: gpt-5.x（跨栈偶现状态环，需先证据后定点修复；忌用最弱模型直接猜改）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.  
> **Branch rule:** 本 plan 仅落在 `main` 的 `.cursor/plans/pending/`；实施前移回 `.cursor/plans/`，在基于 `main` 的功能分支上改代码，再按需同步交付分支。

**Goal:** 消除 Enterprise web-portal 对话流式输出过程中偶发的 React `Maximum update depth exceeded`，避免被误展示为「聊天请求失败」并截断回答。

**Architecture:** 先证据、后定点。用可开关的诊断探针确认是哪条更新链在同一次 React flush 内反复 `setState`/store notify；再按命中的假设修改对应组件。禁止在未拿到 stack / 调用计数前做「顺手大重构」。

**Tech Stack:** React 19、Zustand 5、`@agenticx/feature-chat`、`enterprise/apps/web-portal`、Vitest、浏览器 DevTools。

---

## 背景与证据链（不依赖对话记忆）

### 现场现象

- 产品文案：「聊天请求失败」
- 正文错误：`Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate...`
- 常伴随半截 Thinking / 半截助手正文 → 流已开始，前端渲染环打断后续更新
- 多模型复现样本：`deepseek-v4-flash`（有 Thinking）、`gpt-5.4-nano`（无 Thinking 也断）→ 不是单一推理块问题
- **不是**「Failed to fetch / timeout / aborted」类传输错误

### 错误如何进黄条

`enterprise/features/chat/src/store.ts` 中 `sendMessage` / `editUserMessageAndResend` / `regenerateAssistantResponse` 的 `catch` 会把 `error.message` 写入 `errorMessage`；`MachiChatView` 用 `chatErrorTitle` 展示。

锚点（main 当前）：

```1340:1345:enterprise/features/chat/src/store.ts
      set((prev) =>
        prev.activeSessionId === sessionId
          ? {
              status: "error" as const,
              errorMessage: error instanceof Error ? error.message : "Unknown send error",
            }
```

```487:495:enterprise/apps/web-portal/src/components/MachiChatView.tsx
      {errorMessage && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          ...
              {isComplianceError(errorMessage) ? t("complianceTitle") : t("chatErrorTitle")}
            </AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
```

### 已确认 / 未确认

| 命题 | 状态 |
|------|------|
| 根因属 React 嵌套更新保护，非网络抖动 | **已确认**（错误文案 + 半截流式内容） |
| 共享路径在 `main` 与交付分支均存在，main 也可能中招 | **已确认**（同文件热点） |
| 具体组件已定位为 MessageList / switchModel / ReasoningBlock | **未确认**（缺 componentStack 与更新计数） |
| 异常一定同步从 zustand `set()` 抛进 `sendMessage` catch | **未确认**（需 stack） |

### 嫌疑假设（实施时必须用探针证伪/证实）

| ID | 假设 | 主要落点 |
|----|------|----------|
| H1 | `MessageList` 流式每 chunk：滚动 + FAB `setState` 与 markdown 依赖抖动叠加成环 | `MessageList.tsx` ~269–308、~515、~793–802 |
| H2 | `MachiChatView` `useChatStore()` 无 selector + 模型列表轮询触发 `switchModel` 写 session | `MachiChatView.tsx` ~117、~173–210；`store.ts` `switchModel` ~1051–1073 |
| H3 | `ReasoningBlock` 在 `thinkingInProgress` 翻转时 effect 放大更新 | `ReasoningBlock.tsx` ~57–77 |
| H4 | 其他（Radix Tooltip/Popover、history outbox sync、未知 selector） | 以 stack 为准，不预判 |

---

## In Scope / Out of Scope

### In scope

1. 可开关诊断探针（默认关闭，仅 `localStorage` / query flag 开启）
2. 按 H1–H3 证据结果做**最小定点修复**
3. 不依赖「是否为根因」、但可独立验收的安全加固（见 Task 4，仅在证据阶段后、且不扩大范围时做）
4. 回归测试：流式多 chunk 更新不抛 update-depth；`switchModel` 幂等
5. 中文/英文错误展示：update-depth 类错误不得伪装成网络失败（若现状已是原文则可保持）

### Out of scope

- 重写整个 chat store / 虚拟列表大重构
- Desktop Machi Electron 聊天（除非证据证明共享包改动可无痛复用测试）
- Gateway / 模型供应商 / 合规策略逻辑
- 「顺手」视觉改版、i18n 大扫除、web-search favicon 再优化
- 在交付分支 `hc-0730` 直接落底层修复（应 main 修复后合并）

### no-scope-creep

- 每个代码改动必须映射到本 plan 的 FR/AC
- 未命中假设的文件禁止改
- 禁止以「性能更好」为由改无关渲染路径

---

## 推荐实施模型（子任务）

| 子任务 | Suggested-Impl-Model | 理由 |
|--------|----------------------|------|
| Task 0 探针探针 | Composer 2.5 / 代码专精便宜档 | 样板埋点 |
| Task 1 复现与判据 | 强推理档（GPT-5.x） | 读 stack 定责 |
| Task 2–3 定点修复 | 代码专精中档（Codex）或 GPT-5.x | 状态一致性敏感 |
| Task 4 安全加固 | Composer 2.5 | API 幂等 + 稳定 callback |
| Task 5 测试与验收 | Composer 2.5 | 单测/手测清单 |

最终 `Impl-Model` trailer 以实际使用为准。

---

## Requirements

### FR-0 证据优先

在宣称根因前，必须采集至少一次：

1. 浏览器 Console 完整 stack（含 `forceStoreRerender` / `scheduleUpdateOnFiber` 等）
2. React `componentStack`（ErrorBoundary 或 overlay）
3. 探针日志：崩溃前 50 次更新的 `(source, sessionId, t)` 序列

**AC-0.1** 诊断开关关闭时，生产路径零额外日志、零行为变化。  
**AC-0.2** 开关打开时，复现后 `localStorage` 或 console 能导出更新序列。

### FR-1 消除 update-depth 打断流式

流式对话过程中不得再因该错误进入 `status: "error"` + 黄条截断（同一复现路径下连续 10 次流式长回复）。

**AC-1.1** 手工：deepseek 类带 Thinking + 普通模型长列表 markdown，各跑 10 轮，无 update-depth。  
**AC-1.2** 若仍失败，黄条不得出现；且探针指出的组件必须已按本 plan 修复或明确记为新假设并回写 plan。

### FR-2 `switchModel` 幂等

`activeModel` 与目标相同且 session `active_model` 已相同时，不写 store、不 `patchSession`。

**AC-2.1** 单测：连续两次 `switchModel(sameId)`，第二次不改变 `sessions` 引用 / `updated_at`。  
文件：`enterprise/features/chat/src/store.switch-model.test.ts`（新建）或并入既有 store 测试文件。

### FR-3 MessageList markdown 依赖稳定（若 H1 命中或作为 Task 4 加固）

禁止在 `messages.map` 内创建不稳定的 `onOpenCitationInSheet`；`sessionAttachments` 需 memo，避免无意义重建 `createAssistantMdComponents`。

**AC-3.1** 单测或渲染探测：同一 `sources`/`attachments` 内容下，连续两次 stream delta 后 `components` 引用保持稳定（或文档化：用 spy 断言 factory 调用次数不随纯文本 delta 线性增长）。  
最低 AC：code review 确认 inline lambda 已移除，附件列表经 `useMemo`。

### FR-4 MachiChatView 订阅收敛（若 H2 命中或作为 Task 4 加固）

流式高频字段不得通过无 selector 的 `useChatStore()` 整树订阅驱动顶栏/模型菜单。

**AC-4.1** `messages` / `sessionTokens` 更新时，模型菜单 open 状态与 `availableModels` 不因无关字段重跑「模型不存在则 switchModel」逻辑（effect 依赖收紧或 selector 拆分）。

---

## Tasks

### Task 0: 诊断探针（默认关闭）

Suggested-Impl-Model: Composer 2.5

**Files:**
- Create: `enterprise/features/chat/src/debug/update-depth-probe.ts`
- Modify: `enterprise/features/chat/src/store.ts`（仅在 probe 开启时包一层 `set` 计数；或在 `sendMessage` delta `set` 前后打点——优先**不改 zustand API 形状**，用显式 `probeNote("stream.delta")` 调用）
- Modify: `enterprise/features/chat/src/components/molecules/MessageList.tsx`（effect 入口 `probeNote("MessageList.scrollEffect")` 等）
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`（`switchModel` 调用前 `probeNote`）
- Modify: `enterprise/features/chat/src/components/atoms/ReasoningBlock.tsx`（effect 内 `probeNote`）

**行为约定：**

```ts
// update-depth-probe.ts（意图）
const KEY = "agx.debugUpdateDepth";
export function isUpdateDepthProbeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1" ||
    new URLSearchParams(window.location.search).get("agxUpdateDepthProbe") === "1";
}
export function probeNote(source: string, detail?: Record<string, unknown>): void {
  if (!isUpdateDepthProbeEnabled()) return;
  // ring buffer ≤ 200；console.debug 限流
}
```

**Step 1:** 实现 probe 模块 + 单测「关闭时 note 为空操作」。  
**Step 2:** 在 H1–H3 落点各加 1–2 行 `probeNote`，禁止改业务分支。  
**Step 3:** 文档写进本 plan「复现步骤」：`localStorage.setItem("agx.debugUpdateDepth","1")` 后硬刷新。

**AC:** 关闭探针时 `pnpm`/vitest 相关测绿；打开探针后流式可见序列。

---

### Task 1: 复现并判定假设（只读结论写回 plan）

Suggested-Impl-Model: gpt-5.x

**Steps:**
1. `bash enterprise/scripts/start-dev-with-infra.sh`（或团队惯用 portal 启动）拉起 portal
2. 开启探针；用带 Thinking 模型与普通模型各复现至黄条
3. 保存：Console stack、componentStack、probe ring buffer
4. 在本 plan「判决」一节追加：

```markdown
## 判决（实施时填写）
- 复现日期:
- 命中假设: H1 / H2 / H3 / H4(...)
- stack 摘要:
- 选定修复 Task: 2a / 2b / 2c / ...
```

**AC-1:** 未填写判决前，不得开始 Task 2 业务修复 commit。

---

### Task 2a: 若 H1 命中 — MessageList 定点修复

Suggested-Impl-Model: gpt-5.x / Codex

**Files:**
- Modify: `enterprise/features/chat/src/components/molecules/MessageList.tsx`
  - `flushJumpToBottomFab`：仅当 FAB 可见性**实际变化**时 `setShowJumpToBottomFab`
  - 将 `onOpenCitationInSheet` 提到稳定 `useCallback`（按 messageId 分发），去掉 map 内联箭头
  - `linkedUserAttachments`：按 `linkedUserMessageId` + attachments 内容 memo
- Test: `enterprise/features/chat/src/components/molecules/MessageList.update-depth.test.tsx`（若环境难挂 RTL，则用纯函数抽出「是否应更新 FAB」测 `shouldShowScrollToBottomFab` 旁的 guard）

**Before 意图：** 每个 delta → effect → 可能无条件 setState + markdown components 新引用。  
**After 意图：** FAB setState 幂等；markdown `useMemo` deps 在纯文本 delta 下稳定。

**Out:** 不改消息布局视觉、不引入虚拟列表。

---

### Task 2b: 若 H2 命中 — MachiChatView / switchModel 定点修复

Suggested-Impl-Model: Codex / gpt-5.x

**Files:**
- Modify: `enterprise/features/chat/src/store.ts` `switchModel`（先做幂等，见 Task 4 亦可合并）
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`
  - 拆分 `useChatStore` selector，避免 `messages` 驱动模型兜底 effect
  - 模型兜底 effect 依赖改为：`modelsLoaded`、`activeModel`、**模型 id 列表的稳定序列化**（如 `availableModels.map(m=>m.id).join("|")`），并对 `switchModel` 前再次 `getState().activeModel === next.id` 短路
- Test: `store.switch-model.test.ts`

**Before:**

```ts
set((state) => ({
  activeModel: model,
  sessions: state.sessions.map((session) =>
    session.id === state.activeSessionId
      ? { ...session, active_model: model, updated_at: now() }
      : session
  ),
}));
```

**After 意图：** `activeModel === model && session.active_model === model` 时 `return`；否则再写。轮询刷新 models 数组引用不得单独触发无意义 `switchModel`。

---

### Task 2c: 若 H3 命中 — ReasoningBlock 定点修复

Suggested-Impl-Model: Composer 2.5

**Files:**
- Modify: `enterprise/features/chat/src/components/atoms/ReasoningBlock.tsx`
  - `setOpen(true/false)` 仅在目标值与当前不一致时调用（functional update 内比较，或 ref 记上次 `thinkingInProgress`）
  - `setTick` 间隔逻辑保持，但避免在 `thinkingInProgress` 恒 true 时重复重置 timer 以外的多余 setState

**AC:** Thinking 开/合交互不变；流式长 reasoning 不再触发 update-depth。

---

### Task 2d: 若 H4 命中 — 按 stack 定点

禁止猜测。将新文件路径、before/after、AC 追加进本 plan「判决」后再改。

---

### Task 3: 错误展示与流式恢复策略（轻量）

Suggested-Impl-Model: Composer 2.5

仅当「update-depth 仍可能偶发」或产品要求时：

- Modify: `enterprise/features/chat/src/store.ts` catch：若 `message` 匹配 `/Maximum update depth exceeded/i`，`errorMessage` 可改为用户可读短句（中性，不暴露 React 内部），且**尽量保留已流式 content**（现状已保留则不动 messages）
- 文案走 `messages/zh.json` / `en.json` 的 chat 命名空间（若新增 key）

**Out:** 不把该错误重试自动重发（避免双回复）。

---

### Task 4: 证据后的安全加固（可选，默认做；与命中假设可合并）

Suggested-Impl-Model: Composer 2.5

即使最终根因是 H1，下列改动仍允许（低风险、可测）：

1. `switchModel` 幂等（FR-2）— **建议必做**
2. MessageList 稳定 citation callback + attachments memo（FR-3）— 建议必做
3. MachiChatView 拆 selector（FR-4）— 建议必做，但**不要**借机改 UI 布局

若 Task 1 判决已通过 2a/2b 覆盖，本任务可标完成并跳过重复 commit。

---

### Task 5: 验证清单与探针清理策略

Suggested-Impl-Model: Composer 2.5

1. `pnpm -C enterprise/features/chat test`（或仓库等价 vitest 命令）相关文件全绿
2. 手工 AC-1.1
3. 探针：默认关闭；可保留代码但不得在未开 flag 时输出
4. 实施完成后：将本文件从 `pending/` 移到 `.cursor/plans/`，commits 带：

```
Plan-Id: 2026-07-31-portal-chat-stream-update-depth
Plan-File: .cursor/plans/2026-07-31-portal-chat-stream-update-depth.plan.md
```

---

## 复现步骤（供 Task 1）

1. 启动 enterprise portal（含 gateway/中间件，按 `enterprise/scripts/start-dev-with-infra.sh`）
2. 浏览器：`localStorage.setItem("agx.debugUpdateDepth","1")`，硬刷新
3. 选 reasoning 模型，发送会触发较长 Thinking 的问题；再选非 reasoning 模型发送带列表的长回答需求
4. 若出现黄条：立刻复制 Console stack + `probe` 缓冲
5. 关闭探针：`localStorage.removeItem("agx.debugUpdateDepth")`

---

## 风险

| 风险 | 缓解 |
|------|------|
| 未复现就改代码 | Task 1 门禁 |
| 探针影响性能 | 默认关；ring buffer 上限 |
| 拆 selector 漏字段导致 UI 不刷新 | 对照现有解构字段逐项订阅 |
| 与交付分支分叉 | 只在 main 修，合并时解决冲突 |

---

## 判决（实施时填写）

- 复现日期:
- 命中假设:
- stack 摘要:
- 选定修复 Task:
- 实施备注:
