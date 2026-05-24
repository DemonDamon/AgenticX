# Plan: Token Budget Exceeded 体验改进（无人值守预算硬截停的可感知与可恢复）

- Plan-Id: 2026-05-24-token-budget-exceeded-ux
- Plan-File: .cursor/plans/2026-05-24-token-budget-exceeded-ux.plan.md
- Owner: Damon Li
- Status: Draft

## 背景与问题

`agenticx/runtime/token_budget.py` 实现了一套**会话级累计 token 预算**（默认 `AGX_MAX_TOKENS_PER_SESSION=500000`），分四档：

- 80% WARNING：注入收口提示
- 95% COMPRESS：强制上下文压缩
- 100% EXCEEDED：runtime emit `ERROR` 事件 + `return`，不再调 LLM

实际用户体验（参见 2026-05-24 Machi 桌面端长程 skill 批装任务截图）：

1. 任务跑到 507201/500000，命中 EXCEEDED，runtime 立刻返回。
2. 桌面端状态栏继续显示「无人值守 · 续跑 0/20」、「本会话无人值守：开」。
3. 用户看到底部还有"续跑额度可用 + 无人值守开着"，主观判断"任务应该继续推进"，但实际寸步难行——续跑触发的下一轮 `run_turn` 进入 LLM 前会被同一条 EXCEEDED 规则拦下，emit 同一条错误。
4. 即使是 95% COMPRESS 反复触发后仍超限的情况，UI 上也只是塞一行「上下文接近上限，已压缩 N 条历史但仍超限」，没有「请新建会话续接」的明确出口。

核心缺口：**预算硬截停是一道无法靠"续跑"翻越的墙，但 UI 没有把这件事讲清楚，也没有提供「新建会话续接此任务」的快捷出口**。结果用户既不知道为什么没续，也不知道该怎么继续。

## 目标（Goals）

- **G1**：当 runtime 因 `token_budget` EXCEEDED 终止时，前端能明确知道这是「预算硬截停」，而非普通 stall / 普通 error。
- **G2**：UI 在该状态下清楚告知用户：「会话已达累计 token 预算上限，无人值守续跑无法绕过；请新建会话续接」。
- **G3**：提供一键「新建会话续接此任务」入口，新会话首条 user 消息由旧会话的最新 todo / 关键产出自动起草（可由用户编辑后发送），**不携带历史 chat_history**，从而清零累计预算。
- **G4**：在该状态下，桌面端 status chips 的「无人值守 · 续跑 N/M」要替换或附加为「已达预算上限 · 续跑无效」，避免误导。
- **G5**：让用户可以在 Desktop 设置面板里查看/调整 `AGX_MAX_TOKENS_PER_SESSION` 与 `AGX_MAX_TOKENS_PER_TURN`（持久化到 `~/.agenticx/config.yaml`），作为高级用户的 escape hatch。

## 非目标（Non-Goals）

- 不动 token_budget 的核心检查与分档逻辑（OK/WARNING/COMPRESS/EXCEEDED）。
- 不自动触发「跨会话续接」——必须由用户点击确认，避免静默引入新 session 造成"会话散落"。
- 不改 95% COMPRESS 的上下文压缩策略；该路径已存在，本 plan 只解决 100% 硬截停的体验缺口。
- 不引入新的 LLM 调用或额外的"摘要 agent"来生成新会话首条消息；草稿来自已经持久化的 `todo_write` / 最近 N 条 assistant 消息直接拼接。
- 不改 Enterprise / 网关侧的预算配额（那是 Gateway 维度，跟本地 session-level token_budget 是两套）。

## 技术方案

### 后端：runtime EXCEEDED 事件携带 hint 标识

`agenticx/runtime/agent_runtime.py` 的 `RuntimeEvent(type=ERROR, data={...})` 在 EXCEEDED 分支扩展 data：

```python
data = {
    "text": "Token budget exceeded (507201/500000, source=session). Stopping to preserve results.",
    "detector": "token_budget",
    "budget_exceeded": True,          # 新增：明确语义位
    "budget_source": budget_source,   # 已有，显式回传
    "current": budget_current,
    "max_allowed": budget_max,
    "unattended_useless": True,       # 新增：续跑无效提示位
}
```

### 前端：错误事件分流

`desktop/src/components/ChatPane.tsx` 现有处理：

```5899:5919:desktop/src/components/ChatPane.tsx
            if (payload.type === "error") {
              const errText = String(payload.data?.text ?? "未知错误");
              const severity = String(payload.data?.severity ?? "").trim();
              const detector = String(payload.data?.detector ?? "").trim();
              if (severity === "warning" || detector === "token_budget_compress" || detector === "compactor_circuit_breaker") {
                ...
              } else if (errText.includes("已达到最大工具调用轮数")) {
                ...
              } else {
                addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
              }
            }
```

新增一支处理：当 `payload.data?.budget_exceeded === true` 或 `detector === "token_budget"`：
- 走专属的「BudgetExceededCard」组件（参考已有的 `StallRecoveryCard`），不再用通用 `❌` tool message。
- 同时 `setBudgetExceeded({ source, current, max })` 标记 pane 级状态，让 status chips 与续跑逻辑能感知。

### 前端：续跑短路 + chips 文案

`desktop/src/utils/task-stall-policy.ts` 的 `shouldAllowStallAutoNudge` 新增一个参数 `budgetExceeded: boolean`，当为 true 时直接返回 false。配套调整 `ChatPane.tsx` 触发处。

Status chips 渲染处（line ~6748）改造：
- 正常态：`无人值守 · 续跑 0/20`（保持不变）
- budgetExceeded 时：`已达预算上限 · 续跑无效`（红/橙 chip，可点击弹出新建会话续接面板）

### 前端：BudgetExceededCard 组件

新增 `desktop/src/components/messages/BudgetExceededCard.tsx`，承担：

- 标题：「会话累计 token 已达上限」+ 当前数值（507201 / 500000，source=session）。
- 说明文案：「无人值守续跑无法绕过此限制。建议新建会话续接此任务。」
- 主操作按钮：「新建会话续接此任务」→ 调用 `onResumeInNewSession()`。
- 次要操作：「调整预算上限」→ 跳转 Settings → Runtime → Token Budget。

### 前端：「新建会话续接」流程

- 复用现有 `createNewSession` / `addPaneMessage` 链路。
- 续接 draft 构造规则（不调 LLM，纯文本拼接）：
  1. 旧会话最后一份完整的 `todo_write` 解析结果（若有）→ 作为「待办列表」段落。
  2. 旧会话最后 3 条 assistant 非空 body 文本（截断每条 ≤ 600 字）→ 作为「上次产出摘要」段落。
  3. 用户原始首条 user 消息（若可识别）→ 作为「原始目标」段落。
  4. 末尾追加固定提示："请基于以上信息继续未完成的工作，不要重新开始。"
- Draft 填入新会话输入框（不自动发送），允许用户编辑后再发。

### 设置面板：Runtime token 预算可调

`desktop/src/components/SettingsPanel.tsx` 的 Automation/Runtime 分区新增两项：

- `max_tokens_per_session`（数字输入，默认 500000，范围 100000–5000000）
- `max_tokens_per_turn`（数字输入，默认 100000，范围 50000–1000000）
- 持久化到 `~/.agenticx/config.yaml` 的 `runtime.token_budget.*`，启动时被 `TokenBudgetGuard` 读取（需扩展 `__init__` 优先级：构造参数 > config 文件 > 环境变量 > 默认）。

## 实施分段（Phases）

### P0：后端 EXCEEDED 事件携带语义位（30 min）

- FR-0.1：`agent_runtime.py` 的 EXCEEDED 分支在 `data` 加 `budget_exceeded`/`unattended_useless`/`budget_source`/`current`/`max_allowed` 字段，不改文本内容（保持向后兼容）。
- AC-0.1：手动触发一次预算超限，从 SSE 抓帧能看到新字段。

### P1：前端识别 EXCEEDED 并短路续跑（1h）

- FR-1.1：`ChatPane.tsx` 错误事件分流出 `budget_exceeded` 分支，pane state 增加 `budgetExceededInfo`。
- FR-1.2：`task-stall-policy.ts` 的 `shouldAllowStallAutoNudge` 新增 `budgetExceeded` 入参；调用方传入。
- FR-1.3：Status chips 在 `budgetExceededInfo` 存在时切换为「已达预算上限 · 续跑无效」（颜色对齐已有 stall chip）。
- AC-1.1：手动构造一次 EXCEEDED 帧，续跑配额不再消耗，chips 文案切换。
- AC-1.2：无 EXCEEDED 的普通 stall 场景下，原续跑行为完全不变。

### P2：BudgetExceededCard + 一键新建会话续接（2h）

- FR-2.1：新增 `BudgetExceededCard.tsx`，按上节 UI 规范实现，并在 ChatPane 错误分流处渲染（替代 `❌ ...` 普通气泡）。
- FR-2.2：`createNewSession` 流程支持 `initialDraft` 参数，BudgetExceededCard 主按钮调用之并打开新窗格 / 替换当前窗格 session。
- FR-2.3：Draft 构造工具函数放在 `desktop/src/utils/budget-resume-draft.ts`，纯函数，便于单测。
- FR-2.4：当 BudgetExceededCard 触发时，若**上一条 `role==="assistant"` 且 `hasBody` 为真的消息**正文以未收尾标点（`: ： , ， ; ； 、 — …` 等）结尾，在该消息气泡尾部追加一行轻量小字提示：「此回复因会话预算上限被截停，未完成」（faint 色、不抢视觉，不影响操作行渲染）。判定纯前端：扫消息列表中 budget_exceeded 事件之前最近一条满足条件的 assistant 消息，正则匹配未收尾标点；不调用任何 LLM，不重写消息 `content`，只是渲染层附加的提示行。目的是避免用户误以为「一句没说完的尾巴是被截了一刀」的诡异感。
- AC-2.1：点「新建会话续接」后，新 session 输入框预填草稿，sessionId 为新值，旧会话历史保留，互不串台。
- AC-2.2：Draft 构造工具的单元测试覆盖空 todo / 无 assistant 历史 / 超长文本截断等边界。
- AC-2.3：构造「以冒号 / 中文逗号 / 省略号等未收尾标点结尾的 assistant 消息 + 紧随其后的 budget_exceeded 事件」序列，前端能在该 assistant 气泡尾部渲染未完成提示行；正常完整收尾（句号 / 问号 / 感叹号 / 代码块闭合等）的 assistant 消息**不**显示该提示；非 budget_exceeded 的普通会话状态下也不显示。

### P3：设置面板 Runtime token 预算可视化（1.5h）

- FR-3.1：`SettingsPanel.tsx` 增加 Runtime → Token Budget 区块；UI 控件与现有 `UnattendedConfigSection` / `StallNudgeConfigSection` 风格一致。
- FR-3.2：`~/.agenticx/config.yaml` schema 扩展 `runtime.token_budget: { max_tokens_per_session, max_tokens_per_turn }`，`TokenBudgetGuard.__init__` 读取顺序：构造参数 > config > env > 默认。
- FR-3.3：`agx serve` 启动注入 / `agent_runtime.py` 创建 guard 时统一从 config 读取。
- AC-3.1：在设置里把 max_session 调到 1500000 保存后，重启 `agx serve` 新会话预算上限确实变更。
- AC-3.2：未配置时回落到现有默认 500000，行为完全不变。

### P4：BudgetExceededCard 文案与可观测性微调（30 min）

- FR-4.1：Card 显示「当前累计 X / 上限 Y（约 Z%）」，附带「session_id 已复制到剪贴板」按钮，便于排障。
- AC-4.1：文案在 dark/dim/light 三态主题下可读，不与正文气泡混淆。

## 风险与回滚

- **风险 1**：扩展 `RuntimeEvent.data` 字段会被旧客户端忽略 → 不影响（保持原文本兼容）。
- **风险 2**：「新建会话续接」draft 在很长会话里会拼超长 → 用 600 字截断 + 最多 3 条 assistant 控制上限。
- **风险 3**：用户在设置里把 `max_tokens_per_session` 拉到不合理值（如 10）→ UI 加 `min/max` 边界 + 保存前校验。
- **回滚**：四个 phase 独立，可按 commit 反向 revert；不动 token_budget 核心检查，业务永远兜底回到现有 EXCEEDED 文本展示。

## 测试计划

- **后端**：在 `tests/` 下新增最小冒烟测试，构造一个 token_budget 已耗尽的 `TokenBudgetGuard`，跑一次 `run_turn`，断言事件 `data.budget_exceeded === True`。
- **前端**：
  - `budget-resume-draft.test.ts` 覆盖 draft 构造的边界。
  - `task-stall-policy.test.ts` 现有用例 + 新增 `budgetExceeded=true` 场景断言 `shouldAllowStallAutoNudge` 返回 false。
  - 手测：触发一次真实超限（可临时把 `AGX_MAX_TOKENS_PER_SESSION` 调到 1000 后跑几轮），验证 chips、Card、一键续接、设置面板调整后重启生效全链路。

## 不在本 plan 范围内的延伸想法（仅记录）

- 把 `compact_circuit_breaker` 与 `compaction_reactive` 失败重试也并入「已达预算上限」的统一 BudgetCard 流程——可作为后续独立 plan。
- 跨会话上下文复用（不仅 draft 文本，还包括 taskspaces / context_files 自动迁移）——独立 plan。
- 让 BudgetExceededCard 在 Enterprise 前台也复用（gateway 配额超限场景）——独立 plan。

