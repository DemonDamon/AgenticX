# Deep Research 计划对齐（Gemini 式多轮对话改计划）合并模式

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.x-codex（跨栈高风险收口：orchestrator gate + 前端卡片 + resume 孤儿恢复）

## 背景与动机

现有 deep research 交互模式里，`chat_first`（对话确认）和 `plan_first`（先看计划）是两个独立选项：

- **对话确认**：recon 后弹一个自然语言引导卡（"先和你对齐一下…"），用户回复**一轮**后（无论回复什么，哪怕是"不确定"）就开始检索。只能单轮，无法多轮对话。
- **先看计划**：生成计划草案卡，用户只能在一轮 textarea 里改 subQuestions，点「确认并开始」。不能用自然语言对话式改计划。

用户期望对标 **Gemini 深度调研**：生成一个**方案/计划草案**，然后可以**多轮自然语言对话**不断修改这个方案，直到用户满意点「开始调研」。即把「对话确认」「先看计划」**合并成一种模式**：**计划对齐**。

## 目标

新增统一交互模式 **`plan_chat`（计划对齐）**：
1. recon → 生成计划草案（复用现有 planner）→ 渲染成卡片（显示 objective + subQuestions）
2. 卡片下方有**对话引导**（"如需修改可回复，比如：侧重 X / 增加 Y 方向 / 去掉 Z"）+ 「开始调研」按钮
3. 用户**每回复一轮**：把对话历史 + 当前计划喂给 LLM planner **重新生成计划 v2/v3…**，卡片原地更新版本
4. 用户回复「直接开始/你看着办」或点「开始调研」→ 按当前计划开始检索
5. 支持**多轮**（受 clarify budget 上限约束，默认 3 轮）
6. 重启恢复：多轮对话历史持久化到 run events，进程重启后能恢复继续对话（复用本轮修复的 planSnapshot 孤儿续跑机制）

## 替换关系

- **删除** `chat_first` 和 `plan_first` 两个选项
- **新增** `plan_chat`（计划对齐），UI label「计划对齐」，hint「先看计划，可多轮对话修改再开跑」
- 保留：`auto` / `direct` / `card_first`
- 偏好菜单从 5 项变 4 项

## 现状分析（关键文件）

### 交互策略
`enterprise/apps/web-portal/src/lib/deep-research/interaction-policy.ts`
- `ClarifyUserPreference`：`"auto" | "direct" | "card_first" | "chat_first" | "plan_first"`
- `assessClarifyStrategy()` 返回 `mode: "card" | "chat" | "none"`
- `buildInteractionProfile()`：`planVisibility: "editable"` 当 `preference === "plan_first"`
- `buildChatClarifyPrompt()`：生成对话引导文本
- `parseChatClarifyReply()`：解析对话回复为 slots（当前只用于 clarify，不用于 plan）

### Orchestrator
`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`
- L835-848：`assessClarifyStrategy` + `buildInteractionProfile` + emit `research_profile`
- L933-952：`strategy.mode === "chat"` → emit `clarify_chat` + `waitClarifyGate()` 单轮
- L1016-1084：`profile.planVisibility === "editable"` → emit `research_plan proposed` + `waitClarifyGate({indefinite:true})` + approve/edit/skip 单轮
- L569：`planFn = deps.buildPlan ?? buildResearchPlan`

### Planner
`enterprise/apps/web-portal/src/lib/deep-research/planner.ts`
- `buildResearchPlan(deps)`：非流式 JSON completion，输入 `userQuery` + `reconBrief`，输出 `{topic, complexity, sub_questions}`
- `parseResearchPlanJson(text, fallbackQuery)`：解析 LLM JSON
- `enforcePlanBreadth(plan, userQuery)`：开放题防塌缩

### Gate / resume
`enterprise/apps/web-portal/src/lib/deep-research/run-wait.ts`
- `waitForClarifyResume(runId, timeoutMs)`：等 resume；`timeoutMs<=0` = indefinite
- `resolveClarifyResume(runId, payload)`：payload `{answers, skip}`
- 常量：`CHAT_CLARIFY_ANSWER_KEY="__chat__"`、`PLAN_GATE_ACTION_KEY="__plan_action__"`、`PLAN_GATE_PATCH_KEY="__plan_patch__"`

`enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`
- POST body：`{runId, answers, skip, chatReply, planAction, planPatch, planSnapshot, sessionId, topic, model}`
- 孤儿 plan gate 恢复：`isOrphanedPlanGate` + `parseClientPlanSnapshot` + `reopenForContinue` + `runDeepResearchTurn({continueFromPlanGate})`

### 前端
`enterprise/features/chat/src/utils/deep-research-interaction-pref.ts`
- `DEEP_RESEARCH_INTERACTION_OPTIONS`：5 项选项（含 chat_first / plan_first）

`enterprise/features/chat/src/components/molecules/DeepResearchPreflightCard.tsx`
- 计划草案卡：显示 objective + subQuestions + 「确认并开始」/「修改计划」/「直接开始」
- edit 模式：单轮 textarea 改 subQuestions
- 提交：`/api/chat/deep-research/resume` `{runId, planAction, planPatch, planSnapshot, sessionId, topic, model}`

`enterprise/features/chat/src/components/molecules/DeepResearchClarifyChat.tsx`
- 对话澄清卡：显示 promptText + 单轮回复输入 + 「提交回复」/「直接开始」
- 提交：`/api/chat/deep-research/resume` `{runId, chatReply}` 或 `{runId, skip:true}`

`enterprise/features/chat/src/components/molecules/DeepResearchWorkbench.tsx`
- L538-549：渲染 `DeepResearchPreflightCard`（plan segment）
- 渲染 `DeepResearchClarifyChat`（clarify_chat segment）

## 设计

### 新交互模式 `plan_chat`

`interaction-policy.ts`：
- `ClarifyUserPreference` 删除 `chat_first` / `plan_first`，新增 `plan_chat`
- `assessClarifyStrategy` 新增返回值或复用：`mode: "plan_chat"`（独立于 card/chat/none）
  - 或者更干净：plan_chat 不算 clarify mode，而是 planVisibility 的新值。现状 `planVisibility: "hidden" | "preview" | "editable"`，新增 `"chat_editable"`
  - **推荐**：`planVisibility: "chat_editable"` 当 `preference === "plan_chat"`。`clarifyMode` 仍为 "none"（plan_chat 不走 clarify gate，走 plan gate 的多轮对话）
- `assessClarifyStrategy`：`preference === "plan_chat"` 时返回 `mode: "none"`（无 clarify gate），plan gate 由 planVisibility 驱动

### Orchestrator 多轮 plan 对话 gate

`orchestrator.ts` 替换 L1016-1084 的单轮 plan gate：

```
生成 plan 草案 (planFn) → emit research_plan proposed v1 + awaiting_clarify
if planVisibility === "chat_editable":
  loop (最多 maxRounds 轮):
    emit plan_chat_prompt (对话引导: "如需修改可回复…或点「开始调研」")
    gateResume = await waitClarifyGate({indefinite:true})
    action = parsePlanChatAction(gateResume)  // "start" | "reply" | "skip"
    if action === "start" or "skip":
      emit research_plan approved
      break
    if action === "reply":
      chatReply = gateResume.answers[CHAT_CLARIFY_ANSWER_KEY]
      appendChatTurn(userReply=chatReply)
      plan = await planFn({userQuery: originalQuery + 对话历史 + 当前计划, reconBrief})
      planVersion++
      emit research_plan updated v{planVersion}
      continue
```

**关键改动**：
1. **多轮 gate**：复用 `waitClarifyGate({indefinite:true})`，但每轮 resume 后**重新 emit plan_chat_prompt + 重新 wait**（不是一次 wait 就结束）
2. **对话改计划**：把 `originalQuery + "\n\n【计划对话】\n" + 对话历史 + "\n\n【当前计划 v" + version + "】\n" + JSON.stringify(plan)` 作为 `userQuery` 调 `planFn`，LLM 重新生成计划
3. **新事件类型**：`plan_chat_prompt`（对话引导，含 roundIndex）或复用 `clarify_chat`。**推荐复用 `clarify_chat`**（减少前端改动），但 phase 用 `"plan"` 区分
4. **动作解析**：用户点「开始调研」→ resume `{planAction:"approve"}`；用户回复文本 → resume `{chatReply}`。orchestrator 判断：有 chatReply 且非 skip-signal → 重新生成计划；有 planAction approve → 开始；skip → 按当前计划开始

### Gate payload 扩展

`run-wait.ts` 的 resume payload 已支持 `chatReply`（进 `answers[CHAT_CLARIFY_ANSWER_KEY]`）和 `planAction`（进 `answers[PLAN_GATE_ACTION_KEY]`）。**无需改 run-wait**，orchestrator 从 `gateResume.answers` 读两个 key 判断。

### 前端统一卡片 `DeepResearchPlanChatCard`

**新组件**（或重构 `DeepResearchPreflightCard`），合并现有两卡：

- **计划草案区**：显示当前 plan（objective + subQuestions 列表 + version badge），复用 `PlanBody`
- **对话区**：显示对话引导 + 多轮对话历史（用户回复 + 系统"已更新计划 vN"）
- **输入区**：textarea + 「回复」按钮 + 「开始调研」主按钮
- **交互**：
  - 点「回复」→ POST `/api/chat/deep-research/resume` `{runId, chatReply, planSnapshot, sessionId, topic, model}`，卡片显示"正在更新计划…"loading，等 SSE 推 `research_plan updated` 刷新计划
  - 点「开始调研」→ POST `{runId, planAction:"approve", planSnapshot, ...}`，卡片关闭，开始 lanes
- **重启恢复**：用本轮已有的 `planSnapshot` + `sessionId` + `topic` 孤儿续跑机制；多轮对话历史从 run events 的 `clarify_chat`/`narrative` 重建

### 偏好菜单

`deep-research-interaction-pref.ts`：
- 删除 `chat_first` / `plan_first` 两项
- 新增 `{ id: "plan_chat", label: "计划对齐", hint: "先看计划，可多轮对话修改再开跑" }`
- 共 4 项：auto / direct / card_first / plan_chat
- **迁移**：localStorage 旧值 `chat_first` / `plan_first` → 映射为 `plan_chat`（`normalizeDeepResearchInteractionPref` 加迁移逻辑）

### resume 路由

`resume/route.ts`：
- `plan_chat` 模式的孤儿恢复：复用现有 plan gate 孤儿逻辑（`isOrphanedPlanGate` + `parseClientPlanSnapshot`），但 `continueFromPlanGate` 要支持多轮（`planChatHistory` 传入，orchestrator 从对话历史恢复 roundIndex 继续 wait）
- 新 body 字段：`chatReply` 已有；`planChatRound`（当前对话轮次）可选

## 数据流

```
[偏好=plan_chat]
  recon → assessClarifyStrategy(pref=plan_chat) → mode=none
        → buildInteractionProfile → planVisibility="chat_editable"
        → planFn(原始query) → plan v1
        → emit research_plan proposed v1 (awaiting_clarify)
        → loop:
            emit clarify_chat (phase=plan, promptText="如需修改可回复…")
            waitClarifyGate(indefinite)
            user replies "侧重性能" → POST resume {chatReply:"侧重性能"}
            resolveClarifyResume → gateResume.answers[__chat__]="侧重性能"
            planFn(query+对话历史+当前plan) → plan v2
            emit research_plan updated v2
            continue loop
            user clicks "开始调研" → POST resume {planAction:"approve"}
            gateResume.answers[__plan_action__]="approve"
            emit research_plan approved v2
            break
        → lanes…
```

## 影响面

| 层 | 文件 | 改动 |
|---|---|---|
| 交互策略 | `interaction-policy.ts` | preference 替换；planVisibility 新增 `chat_editable`；新增 plan_chat 引导文本生成；对话历史→planner prompt 构造 |
| Orchestrator | `orchestrator.ts` | 单轮 plan gate → 多轮 plan_chat loop；对话改计划调 planFn；新事件 emit |
| Planner | `planner.ts` | 支持对话历史输入（`userQuery` 已够灵活，可能只需 orchestrator 拼接） |
| 前端偏好 | `deep-research-interaction-pref.ts` | 选项替换 + localStorage 迁移 |
| 前端卡片 | 新 `DeepResearchPlanChatCard.tsx`（或重构 PreflightCard） | 计划+对话统一卡片 |
| Workbench | `DeepResearchWorkbench.tsx` | 渲染新卡片；plan_chat segment |
| resume 路由 | `resume/route.ts` | plan_chat 孤儿恢复（多轮历史） |
| 类型 | `sdk-ts/src/deep-research.ts` / `core-api` | `PlanVisibility` 新增 `chat_editable`；`ClarifyUserPreference` 替换 |
| store | `features/chat/src/store.ts` | `interactionPref` 类型更新 |
| 旧卡清理 | `DeepResearchClarifyChat.tsx` / `DeepResearchPreflightCard.tsx` | 删除或归档（chat_first/plan_first 没了） |

## 测试

- `interaction-policy.test.ts`：`plan_chat` → planVisibility=chat_editable、clarifyMode=none；旧 chat_first/plan_first 迁移
- `orchestrator.test.ts`：plan_chat 多轮 loop（mock planFn 验证第二轮调用入参含对话历史）；「开始调研」break；skip 按当前计划开始
- `planner.test.ts`：对话历史拼接入参 → LLM 重新生成
- 前端卡片测试：多轮回复 → 计划版本递增；「开始调研」提交 planAction=approve
- resume 孤儿测试：plan_chat 重启后带对话历史恢复
- localStorage 迁移测试：chat_first/plan_first → plan_chat

## 验收

1. 选「计划对齐」发问 → 出计划草案卡 + 对话引导
2. 回复"侧重性能" → 计划更新 v2（subQuestions 变化）
3. 再回复"增加成本分析" → 计划更新 v3
4. 点「开始调研」 → 按 v3 开始 lanes
5. 回复"直接开始" → 按当前计划开始
6. 多轮中重启进程 → 恢复后继续对话（run events 有完整历史）
7. auto/direct/card_first 行为不变

## 风险与权衡

- **LLM 改计划延迟**：每轮回复要调一次 planner（非流式 ~2-5s），用户要等。需 loading 态。
- **多轮 token 成本**：对话历史累积，planner prompt 变长。限制 maxRounds=3，对话历史截断。
- **复杂度**：多轮 gate + 重启恢复 + 前端卡片，改动大。**建议分两阶段**：(1) 先做单轮「计划+对话」合并卡（回复一次改计划，点开始）； (2) 再扩多轮。但用户明确要多轮，故一次到位。
- **Out of scope**：不改 auto/direct/card_first；不改 midrun clarify；不改 report writer；不动 run-store schema（对话历史走 events，无需新表）。

## 开放问题（实施前需确认）

1. 对话历史在 run events 里怎么存？**建议**：复用 `clarify_chat`（promptText=系统引导）+ 新增 `plan_chat_reply`（用户回复）+ `research_plan updated`（系统更新）。或全部塞进 `clarify_chat` 的 roundIndex 递增。**倾向后者**，少改类型。
2. 「开始调研」按钮文案：Gemini 是"开始调研"。**用这个**。
3. 对话引导文案：Gemini 是"方案更新完毕，您可以通过以下方式继续：调整预算/时间范围/数据来源或添加您想了解的任何问题"。**仿这个**：显示当前计划 + "如需修改可回复（如：侧重 X / 增加 Y / 去掉 Z），或点「开始调研」"。
