# Web Portal 深度调研中英文 i18n Implementation Plan

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: Composer 2.5

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户把 web-portal 切到 English 后，深度调研整条链路（composer 芯片、消息操作按钮、进度卡、后端 canned 旁白/阶段文案、LLM 车道标题与报告）都显示英文；切回中文则全部中文。默认仍是 `zh`。

**Architecture:** Portal locale 以 cookie `NEXT_LOCALE` 为唯一真相（与现有 `enterprise/docs/architecture/i18n.md` 一致）。`MachiChatView` 等 app 组件继续 `useTranslations`。`@agenticx/feature-chat` **不引入 next-intl**，用自带 zh/en 词典 + `ChatLocaleProvider`。BFF `runDeepResearchTurn` 读同一 cookie，用服务端 copy 发 SSE；所有调研 SYSTEM prompt 追加语言指令。前端 `buildDeepResearchSegments` 不再用中文正则当唯一完成态改写。

**Tech Stack:** Next.js 15 + next-intl（仅 `apps/web-portal`）+ Vitest。不改 `desktop/`、不改 admin-console、不改 Gateway。

---

## 子规划 → 推荐实施模型

| 子规划 | Suggested-Impl-Model | 理由 |
|---|---|---|
| Wave 1 feature-chat locale 壳 + 消息操作条 | Composer 2.5 | 抽词，无审美重塑 |
| Wave 2 composer 确认方式芯片 | Composer 2.5 | 已有 next-intl，机械替换 |
| Wave 3 进度卡 / segments 文案 | Composer 2.5 | 纯函数加 copy 参数 |
| Wave 4 BFF locale + canned SSE | Composer 2.5 | 后端接线 + 现有 orchestrator 测试扩 locale |
| Wave 5 LLM 工作语言 + 澄清兜底 | Composer 2.5 | 提示词追加指令 + 兜底题双语，勿重写规划算法 |

最终 `Impl-Model` trailer 以实际使用为准，实施前向用户确认。

---

## 根因与证据（不依赖对话记忆）

用户截图发生在 **UI 已是 English**（composer placeholder = `Describe your question to generate a deep research report`，芯片主文案 = `Deep research`，均来自 `enterprise/apps/web-portal/messages/en.json`）。剩下的中文不是 locale 没切，而是这些路径从未接 i18n：

| 截图现象 | 根因 | 证据 |
|---|---|---|
| 芯片旁「自动」、菜单「澄清与计划确认方式」 | `DEEP_RESEARCH_INTERACTION_OPTIONS` 写死中文 label/hint；`MachiChatView` 菜单标题写死 | `enterprise/features/chat/src/utils/deep-research-interaction-pref.ts` L52–75；`enterprise/apps/web-portal/src/components/MachiChatView.tsx` L883–898 |
| 气泡操作「多选 / 复制」tooltip | `MessageList` 硬编码 | `enterprise/features/chat/src/components/molecules/MessageList.tsx` L1085、L1102（同文件还有「编辑 / 重新生成 / 分享 / 有帮助 / 没帮助 / 复制文本」） |
| 「我先快速检索最新公开资料…」 | orchestrator 写死 narrative | `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` L1198–1203 |
| 「开题冷启动检索… · 已完成」 | 后端 phase message 中文 + 前端 `finalizeToolsCardTitle` 用中文正则补「· 已完成」 | orchestrator L1203；`deep-research-segments.ts` L66–94、L54 `title: "搜索网页"` |
| 「已拆解 8 条调研车道…」+ 车道 query 全中文 | canned message 中文；planner / clarifier SYSTEM 全中文，无 locale | orchestrator L1461；`planner.ts` L37–42；`clarifier.ts` L38–55；`research-intent.ts` L30–50 |
| 2016-05 企业 i18n 没覆盖这条链路 | ESLint `no-literal-string` 只扫 `apps/web-portal/src/{app,components}`，**不含** `features/chat` 与 `lib/deep-research` | `enterprise/apps/web-portal/eslint.config.mjs` L10；`enterprise/docs/architecture/i18n.md`「后端 API message 不做 i18n」 |

**产品决策（已锁定，实施不得改）：**

1. 语言仅 `zh` / `en`。来源 = cookie `NEXT_LOCALE`（与登录页 / 顶栏切换同一套）。未设 cookie 时默认 `zh`（与 `enterprise/apps/web-portal/src/i18n/routing.ts` `defaultLocale` 一致）。
2. **Chrome + canned SSE + LLM 面向用户产出** 一律跟 portal locale，不另做「检测用户 query 语言再覆盖」。用户切 English 后，即便历史气泡里有中文旧事件，**新 run** 必须英文化。
3. 不翻译：用户自己打的消息正文、已落盘的旧 SSE `message`/`text`/`title`（按原文展示）、品牌名、URL、DOI、模型名。
4. `@agenticx/feature-chat` **禁止** `import "next-intl"`（保持包可单测、不绑 App Router）。
5. 不改 `DeepResearchEvent` 协议字段（不加 `code`），避免旧 hydrate / persist 分叉。canned 文案在 **emit 时按 locale 写成最终字符串**。
6. `finalizeToolsCardTitle` / `completedPhaseTitle` 必须同时识别 zh **和** en 进行态后缀，禁止再出现「English phase + `· 已完成`」混搭。

---

## In scope

- `enterprise/features/chat` 深度调研与消息操作条用户可见文案（本 plan 列出的文件）
- `enterprise/apps/web-portal/src/components/MachiChatView.tsx` 确认方式芯片
- `enterprise/apps/web-portal/messages/{zh,en}.json` 新增 `workspace.deepResearchInteraction*` / `chat.messageActions*`（仅 app 层用到的键）
- `enterprise/apps/web-portal/src/lib/deep-research/` canned copy + locale 注入 + LLM 语言指令
- `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` 与 `.../deep-research/resume/route.ts` 传入 locale
- 对应 Vitest

## Out of scope（严禁顺手做）

- `desktop/`、admin-console、官网
- 协作房间 `RoomChatView` 全量 i18n（除非同一文件里为复用 ChatLocale 必须包一层 Provider，禁止顺手抽房间文案）
- 知识库 / 设置页 / 配额卡新文案
- `DeepResearchFilesPanel` / `AttachmentContentPanel` 全量（用户本次截图未覆盖；Wave 3 只动进度卡/segments/clarify/preflight/plan 卡标题）
- 改规划算法、车道数、澄清策略、预算、SSE 协议
- 给 phase event 加 `code` 字段或重做事件模型
- 把历史中文 run 回译成英文
- 改 `agenticx/studio/server.py`
- 第三种语言、RTL、翻译平台

---

## no-scope-creep 边界

每个 diff 必须能追溯到本 plan 某条 FR / 某 Wave。禁止顺手重构 orchestrator 控制流、禁止「顺便」改 MessageList 布局/hover 行为、禁止把英文当中文界面默认。

---

## FR / AC

**FR-1** feature-chat 能按 `zh`/`en` 取 chrome 文案；未包 Provider 时默认 `zh`（兼容现有单测）。  
**AC-1** `enterprise/features/chat/src/i18n/chat-copy.test.ts`：en 词典无 CJK；zh/en key 集合全等；`getChatCopy("en").messageActions.copy === "Copy"`。

**FR-2** English locale 下用户/助手气泡操作 tooltip 与多选底栏为英文。  
**AC-2** `MessageList` 内截图相关字面量消失：`复制`/`多选`/`编辑`/`重新生成`/`分享`/`有帮助`/`没帮助`/`复制请求 ID`/`复制文本`/`取消`/`发送`/`上一版回复`/`下一版回复` 全部改走 `useChatCopy()`。`pnpm -C enterprise/features/chat test` 绿。

**FR-3** English locale 下深度调研芯片「Auto」+ 菜单标题/四选项/hint 为英文。  
**AC-3** `enterprise/apps/web-portal/src/components/deep-research-interaction-i18n.test.ts`：en.json 对应键无 CJK。`labelForDeepResearchInteractionPref("auto", "en") === "Auto"`。手动：`document.cookie="NEXT_LOCALE=en;path=/"` 刷新后芯片为 `Deep research` + `Auto`，菜单标题为 `Clarification and plan confirmation`。

**FR-4** English locale 下进度卡不再出现「搜索网页 / 开题冷启动 / 已拆解 / · 已完成 / 正在撰写报告」。  
**AC-4** `deep-research-segments.test.ts` 增补 en copy 用例：`laneToStep` 标题为 `Search web`；`finalizeToolsCardTitle("Broke down 8 research lanes, searching in parallel…", 8, true)` **不含** `已完成`，应为 `Broke down 8 research lanes` 或 copy 提供的完成态句。

**FR-5** BFF 新 run 的 canned narrative/phase 跟 locale。  
**AC-5** `orchestrator.test.ts`：`deps.locale = "en"` 时事件含 `I'll quickly search the latest public sources to calibrate the research premise.`（或本 plan 锁定英文原文），**不含** `校准调研前提` / `开题冷启动检索` / `已拆解`。`locale` 缺省或 `"zh"` 时保持现有中文，避免中文回归。

**FR-6** English locale 下 clarifier 兜底题、focus options、LLM 面向用户文本用英文。  
**AC-6** `defaultOpenEndedClarification(query, "en")` 的 `question` 无 CJK。`languageDirective("en")` 被拼进 clarifier/planner/expander/reflector/report-writer/lane-summary/completion-summary 的 system（单测 spy 或对 `buildXxxMessages` 助手函数断言 `toContain("Write all user-facing")`）。

**FR-7** completions 与 resume 两条入口都注入 locale。  
**AC-7** 抽 `resolvePortalLocaleFromCookies()`；两处 `runDeepResearchTurn(..., { locale })`。单测或轻量 route 测试：cookie `NEXT_LOCALE=en` → deps.locale `"en"`。

---

## 语言策略（实施必须按此写英文，禁止自行润色改义）

服务端 copy 锁原文，避免实施模型「发挥」导致测试对不上。

### `enterprise/apps/web-portal/src/lib/deep-research/copy.ts`

```ts
export type PortalLocale = "zh" | "en";

export function languageDirective(locale: PortalLocale): string {
  return locale === "en"
    ? "Write ALL user-facing text in English: narratives, clarify questions/options, plan titles, lane titles, memos, report sections, and completion summary. Keep proper nouns, paper titles, and citations unchanged."
    : "所有面向用户的文本使用简体中文：旁白、澄清题/选项、计划标题、车道标题、备忘、报告章节、完成摘要。专有名词、论文标题与引用保持原样。";
}

export function deepResearchCopy(locale: PortalLocale) {
  if (locale === "en") {
    return {
      offlineMode:
        "This environment cannot reach the public web. Deep research switched to existing-materials-only mode; conclusions will not include live external sources.",
      readingDirectPage:
        "Reading the public page you specified. Later research lanes will reuse it and locate passages against the question.",
      updatingPlan: "Updating the plan from your feedback…",
      resumedPlanConfirm: "Restored the interrupted plan confirmation. Continuing research.",
      resumedPlanChat: "Restored the interrupted plan alignment. You can keep editing or start research.",
      reconNarrative:
        "I'll quickly search the latest public sources to calibrate the research premise.",
      reconPhase: "Scanning the latest public context…",
      coldStartPhase: "Topic cold-start search…",
      coldStartLaneTitle: "Topic cold start",
      reconSources: (n: number) => `Collected ${n} sources`,
      clarifyPhase: "Checking whether clarification is needed…",
      afterReconClarify: "Context is calibrated. Confirm the research direction next.",
      planPhase: "Planning the research path…",
      lanesStarted: (n: number) =>
        `Broke down ${n} research lanes, searching in parallel…`,
      expandedQueries: (n: number) => `Expanded ${n} search queries`,
      skippedQueries: (run: number, skipped: number) =>
        `Enough candidates; ran ${run} queries and skipped ${skipped}`,
      discoveredSources: (n: number) => `Found ${n} candidate sources`,
      selectedSources: (sel: number, pool: number) =>
        `Selected ${sel}/${pool} high-quality sources`,
      collectingSources: (n: number) =>
        `Collected ${n} sources, fetching page text…`,
      searchAllFailed: "All searches failed",
      midrunClarify: "Evidence is still thin. Confirm one key point, then continue.",
      reflectPhase: "Reviewing collected evidence for information gaps…",
      fillingGaps: (n: number) => `Running follow-up search for ${n} gaps…`,
      noGaps: "Cross-checks look sufficient; no follow-up search needed.",
      retrieveDone:
        "Retrieval is complete and the evidence is sufficient. Moving on to synthesis and the report.",
      outlinePhase: "Drafting the report outline…",
      writingSection: (i: number, total: number, title: string) =>
        `Writing section ${i}/${total}: ${title}`,
      synthesizePhase: "Synthesizing…",
      done: "Deep research complete",
      cancelled: "Cancelled",
      policyBlocked: "A compliance policy blocked report writing",
      donePartial: "Deep research complete (some wrap-up steps failed)",
      failed: "Failed",
      clarifyPrefix: "User clarifications",
      researchTopicFallback: "research topic",
    };
  }
  // zh：必须与当前 orchestrator 字面量逐字相同（回归锁）
  return {
    offlineMode:
      "当前环境无法访问外部网站，深度调研已切换为「仅基于已有资料」模式，结论不含外部实时来源。",
    readingDirectPage:
      "正在直接读取用户指定的公开页面，后续研究车道会复用并按问题定位片段。",
    updatingPlan: "正在根据你的反馈更新计划…",
    resumedPlanConfirm: "已恢复中断的计划确认，继续执行研究。",
    resumedPlanChat: "已恢复中断的计划对齐，可继续修改或开始调研。",
    reconNarrative: "我先快速检索最新公开资料，校准调研前提。",
    reconPhase: "正在快速侦查最新现状…",
    coldStartPhase: "开题冷启动检索…",
    coldStartLaneTitle: "开题冷启动",
    reconSources: (n: number) => `已收集 ${n} 个来源`,
    clarifyPhase: "正在判断是否需要澄清…",
    afterReconClarify: "现状已校准，再确认一下调研方向。",
    planPhase: "正在规划研究路径…",
    lanesStarted: (n: number) => `已拆解 ${n} 条调研车道，正在并行检索…`,
    expandedQueries: (n: number) => `已展开 ${n} 条检索式`,
    skippedQueries: (run: number, skipped: number) =>
      `候选已够用，实际检索 ${run} 条，省去 ${skipped} 条检索式`,
    discoveredSources: (n: number) => `发现 ${n} 个候选来源`,
    selectedSources: (sel: number, pool: number) =>
      `筛选出 ${sel}/${pool} 个高质量来源`,
    collectingSources: (n: number) => `已收集 ${n} 个来源，正在读取正文…`,
    searchAllFailed: "检索全部失败",
    midrunClarify: "目前证据偏薄，再确认一个关键点后继续。",
    reflectPhase: "正在复盘已收集证据，识别信息缺口…",
    fillingGaps: (n: number) => `正在针对 ${n} 处缺口补充检索…`,
    noGaps: "证据交叉验证充分，未发现需要补搜的缺口。",
    retrieveDone: "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
    outlinePhase: "正在拟定报告大纲…",
    writingSection: (i: number, total: number, title: string) =>
      `正在撰写第 ${i}/${total} 节：${title}`,
    synthesizePhase: "正在综合分析…",
    done: "深度研究完成",
    cancelled: "已取消",
    policyBlocked: "合规策略已拦截报告撰写",
    donePartial: "深度研究完成（部分收尾失败）",
    failed: "失败",
    clarifyPrefix: "用户澄清",
    researchTopicFallback: "研究主题",
  };
}
```

`applyClarifyAnswers`（orchestrator L594）把 `【用户澄清】` 换成 `copy.clarifyPrefix`（en: `User clarifications`，包在同一 `【】` 或改为 `\n\n${copy.clarifyPrefix}\n`，en 用 `\n\nUser clarifications:\n`）。

---

## Wave 1 — feature-chat locale 壳 + 消息操作条

### Task 1: 词典 + Provider

**Files:**
- Create: `enterprise/features/chat/src/i18n/chat-copy.ts`
- Create: `enterprise/features/chat/src/i18n/ChatLocaleProvider.tsx`
- Create: `enterprise/features/chat/src/i18n/chat-copy.test.ts`
- Modify: `enterprise/features/chat/src/index.ts`（export Provider / `useChatCopy` / `getChatCopy`）

**词典最小键（Wave 1，必须成对）：**

```
messageActions.copy
messageActions.multiSelect
messageActions.edit
messageActions.retry
messageActions.share
messageActions.helpful
messageActions.unhelpful
messageActions.copyTraceId
messageActions.copyText
messageActions.cancel
messageActions.send
messageActions.prevVersion
messageActions.nextVersion
messageActions.userRole
messageActions.assistantRole
interaction.auto
interaction.direct
interaction.cardFirst
interaction.planChat
```

en 锁原文：`Copy` / `Multi-select` / `Edit` / `Regenerate` / `Share` / `Helpful` / `Not helpful` / `Copy request ID` / `Copy text` / `Cancel` / `Send` / `Previous reply` / `Next reply` / `User` / `Assistant` / `Auto` / `Start now` / `Card confirm` / `Plan alignment`。

**Provider 意图：**

```tsx
// ChatLocaleProvider.tsx
const ChatLocaleContext = React.createContext<PortalLocale>("zh");
export function ChatLocaleProvider({ locale, children }: { locale: PortalLocale; children: React.ReactNode }) {
  const value = locale === "en" ? "en" : "zh";
  return <ChatLocaleContext.Provider value={value}>{children}</ChatLocaleContext.Provider>;
}
export function useChatLocale(): PortalLocale {
  return React.useContext(ChatLocaleContext);
}
export function useChatCopy() {
  return getChatCopy(useChatLocale());
}
```

**注入点（只包一层，禁止到处包）：**

`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`：已有 `const { locale } = useLocale()`（约 L83）。在 return 的聊天主列外包：

```tsx
<ChatLocaleProvider locale={locale === "en" ? "en" : "zh"}>
  {/* 现有 MachiChatView / 设置 等 */}
</ChatLocaleProvider>
```

`MachiChatView` 自己渲染 `MessageList`，不要在 `MessageList` 内部再读 next-intl。

### Task 2: MessageList 抽词

**Files:**
- Modify: `enterprise/features/chat/src/components/molecules/MessageList.tsx` L1038–1373

**Before：** `<TooltipContent>复制</TooltipContent>` / `多选` / 底栏 `复制文本`，多选拼接用 `` `${m.role === "user" ? "用户" : "助手"}` ``。

**After：** `const copy = useChatCopy();` 后全部 `copy.messageActions.*`。多选拼接：

```ts
`${m.role === "user" ? copy.messageActions.userRole : copy.messageActions.assistantRole}: ${toCopyableMessageText(m)}`
```

**测试：** 现有 MessageList 若无 RTL 渲染测，不强制加 component 测。`chat-copy.test.ts` 锁 key。`pnpm -C enterprise/features/chat test`。

### Task 3: interaction pref 去中文字面量

**Files:**
- Modify: `enterprise/features/chat/src/utils/deep-research-interaction-pref.ts`
- Modify: `enterprise/features/chat/src/utils/deep-research-interaction-pref.test.ts`

**Before：** `DEEP_RESEARCH_INTERACTION_OPTIONS` 带中文 `label`/`hint`；`labelForDeepResearchInteractionPref` 无 locale。

**After：**

```ts
export const DEEP_RESEARCH_INTERACTION_OPTION_IDS = [
  "auto",
  "direct",
  "card_first",
  "plan_chat",
] as const;

export function labelForDeepResearchInteractionPref(
  pref: DeepResearchInteractionPref,
  locale: "zh" | "en" = "zh",
): string {
  const copy = getChatCopy(locale);
  const map = {
    auto: copy.interaction.auto,
    direct: copy.interaction.direct,
    card_first: copy.interaction.cardFirst,
    plan_chat: copy.interaction.planChat,
  };
  return map[pref] ?? map.auto;
}
```

删掉（或停用）带中文的 `DEEP_RESEARCH_INTERACTION_OPTIONS` 常量。`MachiChatView` 改为自建选项列表（Wave 2）。测试改为断言 `labelForDeepResearchInteractionPref("auto", "en") === "Auto"` 以及 zh 仍为 `自动`。

---

## Wave 2 — composer 确认方式芯片（web-portal next-intl）

**Files:**
- Modify: `enterprise/apps/web-portal/messages/zh.json`、`en.json`
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx` L853–926、L1059
- Create: `enterprise/apps/web-portal/src/components/deep-research-interaction-i18n.test.ts`（照 `chat-composer-i18n.test.ts`）

**新增键（`workspace` 命名空间，成对）：**

| key | zh | en |
|---|---|---|
| `deepResearchInteractionTitle` | 澄清与计划确认方式 | Clarification and plan confirmation |
| `deepResearchInteractionAria` | 确认方式：{label} | Confirmation style: {label} |
| `deepResearchInteractionHint` | 澄清与计划确认方式：{label}（点击切换） | Clarification and plan confirmation: {label} (click to switch) |
| `deepResearchPlanGateHint` | 请先确认或继续修改研究计划 | Confirm or keep editing the research plan first |
| `deepResearchInteractionAuto` | 自动 | Auto |
| `deepResearchInteractionAutoHint` | 由系统判断是否需要问我 | Let the system decide whether to ask you |
| `deepResearchInteractionDirect` | 直接开始 | Start now |
| `deepResearchInteractionDirectHint` | 能合理假设时不要等我确认 | Don't wait for confirmation when assumptions are reasonable |
| `deepResearchInteractionCard` | 卡片确认 | Card confirm |
| `deepResearchInteractionCardHint` | 开始前用选项卡确认关键方向 | Confirm key directions with a card before starting |
| `deepResearchInteractionPlan` | 计划对齐 | Plan alignment |
| `deepResearchInteractionPlanHint` | 先看计划，可多轮对话修改再开跑 | Review the plan and edit it in chat before running |
| `copySessionId` | 复制会话 ID | Copy session ID |

**Before（L883–898）：**

```tsx
title={`澄清与计划确认方式：${labelForDeepResearchInteractionPref(interactionPref)}（点击切换）`}
...
<div>澄清与计划确认方式</div>
{DEEP_RESEARCH_INTERACTION_OPTIONS.map(...)}
```

**After：** `tw("deepResearchInteractionAuto")` 等；选项数组在组件内用 id + `tw` 拼，**不要**再 import 中文 OPTIONS。chip 短标签：`tw` 映射，不要 `labelForDeepResearchInteractionPref`（避免 feature-chat 词典与 portal 词典双源）。`labelForDeepResearchInteractionPref` 仅留给 feature-chat 内部若仍需要。

L1059 `<TooltipContent>复制会话 ID</TooltipContent>` → `tw("copySessionId")` 或 `tc("copySessionId")`（与文件现有 `useTranslations` hook 名对齐；该文件已有 `tw`）。

---

## Wave 3 — 进度卡 / segments / 澄清卡 chrome

**Files:**
- Modify: `enterprise/features/chat/src/i18n/chat-copy.ts`（扩键）
- Modify: `enterprise/features/chat/src/components/molecules/deep-research-segments.ts`
- Modify: `enterprise/features/chat/src/components/molecules/deep-research-segments.test.ts`
- Modify: `enterprise/features/chat/src/components/molecules/deep-research-steps.ts` L212
- Modify: `enterprise/features/chat/src/components/molecules/deep-research-timeline-labels.ts`
- Modify: `enterprise/features/chat/src/utils/deep-research-active-run.ts` L13–19
- Modify: DeepResearch 卡：`DeepResearchClarifyCard.tsx`、`DeepResearchClarifyChat.tsx`、`DeepResearchPreflightCard.tsx`、`DeepResearchPlanChatCard.tsx`、`DeepResearchRecoverBanner.tsx`、`DeepResearchTimeline.tsx`（只替换 JSX/返回字符串里的用户可见中文，不改交互状态机）

**segments 关键改法（禁止只改后端、前端仍用中文正则）：**

`buildDeepResearchSegments(events, status, copy = getChatCopy("zh"))`

`laneToStep`：`title: copy.segments.searchWeb`（en: `Search web`）。

`finalizeToolsCardTitle(title, stepCount, settled, copy)`：

```ts
const raw = title.trim() || copy.segments.parallelSearching;
if (!settled) return raw;
let next = raw
  .replace(/[，,]?\s*正在并行检索…?\s*$/u, "")
  .replace(/正在并行检索…?/gu, "")
  .replace(/[,-]?\s*searching in parallel…?\s*$/i, "")
  .replace(/searching in parallel…?/gi, "")
  .trim();
if (!next) return copy.segments.completedLanes(stepCount);
if (/已拆解/.test(next)) {
  next = next.replace(/已拆解/, "已完成");
  if (!/检索/.test(next)) next = `${next}检索`;
  return next;
}
if (/^Broke down\b/i.test(next)) {
  return next.replace(/^Broke down/i, "Completed");
}
if (next.startsWith("正在")) return `已${next.replace(/^正在/u, "").replace(/…+$/u, "")}`;
if (/^(Scanning|Checking|Planning|Drafting|Writing|Synthesizing|Topic cold-start|Reviewing)\b/i.test(next)) {
  return next.replace(/…+$/u, "");
}
if (!/完成|已完成|结束|complete|completed|done/i.test(next)) {
  return `${next} · ${copy.segments.doneSuffix}`;
}
return next;
```

en `doneSuffix` = `Done`。zh `doneSuffix` = `已完成`（保持「开题冷启动检索… · 已完成」中文观感）。

`completedPhaseTitle`：保留现有中文分支；新增 `Synthesizing` → copy 的完成态（en: `Finished synthesis`）。`flushWrite` 标题：`copy.segments.writingReport` / `copy.segments.finishedWriting(n)`。

默认参数 `getChatCopy("zh")` 让**现有中文 fixture 单测不用全改**。另写一组 `getChatCopy("en")` 断言。

React 渲染路径：`DeepResearchWorkbench` / 调用 `buildDeepResearchSegments` 处传入 `useChatCopy()`。先 `rg "buildDeepResearchSegments"` 只改调用点，禁止改函数语义。

**ClarifyCard 锁英文（L209 附近）：**  
zh 保持。en：`I'll quickly confirm the research direction, then start a systematic search. You can pick more than one option per question. Please reply within 5 minutes.`（若原文有「5 分钟」则保留数字）。`可多选` → `Multi-select`；`请选一个` → `Select one`。

---

## Wave 4 — BFF locale + canned SSE

### Task 1: resolvePortalLocale

**Files:**
- Create: `enterprise/apps/web-portal/src/lib/portal-locale.ts`
- Create: `enterprise/apps/web-portal/src/lib/portal-locale.test.ts`

```ts
import { cookies } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isAppLocale, type AppLocale } from "../i18n/routing";

export function localeFromCookieValue(raw: string | undefined | null): AppLocale {
  return isAppLocale(raw) ? raw : defaultLocale;
}

export async function resolvePortalLocaleFromCookies(): Promise<AppLocale> {
  const store = await cookies();
  return localeFromCookieValue(store.get(LOCALE_COOKIE)?.value);
}
```

单测只测 `localeFromCookieValue`（纯函数）：`en`/`zh`/垃圾值/`undefined`。

### Task 2: deps.locale 贯穿

**Files:**
- Modify: `orchestrator.ts` `DeepResearchDeps` 增加 `locale?: "zh" | "en"`
- Modify: `runDeepResearchTurn` 开头 `const locale = deps.locale === "en" ? "en" : "zh"; const copy = deepResearchCopy(locale);`
- 将本 plan「语言策略」列出的 **全部** `enqueueEvent` / `text:` / `message:` 中文换成 `copy.*`（L882–2583 清单，一张不漏）
- Modify: `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` L213 的 `runDeepResearchTurn` 参数加 `locale: await resolvePortalLocaleFromCookies()`
- Modify: `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts` **两处** `runDeepResearchTurn`（约 L597、L718）同样传入

**测试：** 在现有 `orchestrator.test.ts` 复制一条最小 happy-path（已有 recon narrative 断言的那条，约 L1065），加 `locale: "en"`，断言英文锁原文、断言 `校准调研前提` 不出现。默认用例保持中文断言，防止中文回归。

`FEATURE_DENIED_MESSAGE`（completions L48–51）本次 **可以** 顺带按 locale 返回（同一次 cookie 读取），en：`Web search is not enabled for this account` / `Deep research is not enabled for this account`。若不想碰 403 文案，标为 optional；不要因此改能力包逻辑。

---

## Wave 5 — LLM 工作语言 + 澄清/规划兜底

**Files:**
- Create or modify: `copy.ts` 的 `languageDirective`（Wave 4 已建则复用）
- Modify: `clarifier.ts` — `CLARIFIER_SYSTEM` 末尾 `+ languageDirective(locale)`；`defaultOpenEndedClarification(userQuery, locale)`
- Modify: `research-intent.ts` — `defaultFocusOptions(query, locale)` / `defaultFacetLanes(topic, locale)` 英文选项锁原文：
  - 模型类：`Architecture innovations (e.g. MoE, attention)` / `Training data and optimization` / `Inference, serving, and cost` / `Evaluation and typical applications`
  - 默认：`Definitions and recent progress` / `Key mechanisms and details` / `Practice and deployment` / `Limits, debates, and gaps`
  - 兜底题 en：`Which aspects of “${topic}” do you want to focus on? (multi-select)`
- Modify: `planner.ts` / `query-expander.ts` / `reflector.ts` / `report-writer.ts` / `completion-summary.ts` / orchestrator `LANE_SUMMARY_SYSTEM` / `citation-verifier.ts` 的 system 字符串：**只追加** `languageDirective(locale)`，禁止重写整段中文 system（避免改变 JSON schema 约束）。
- `DeepResearchDeps` / 各 `XxxDeps` 增加可选 `locale`，由 orchestrator 往下传。调用处漏传则默认 `zh`。
- `report-html.ts` L563 `<html lang="zh-CN">` → `locale === "en" ? "en" : "zh-CN"`（若函数能拿到 locale；拿不到则从 deps 往下传，禁止猜）。

**测试：**
- `research-intent` / `clarifier` 单测：`locale: "en"` 无 CJK。
- planner/clarifier 若已有 system 快照测，改为 `toContain(languageDirective("en"))`。
- 不要求对真实 LLM 做集成测。

---

## 验收（实施者自测）

1. `pnpm -C enterprise/features/chat test`
2. `pnpm -C enterprise/apps/web-portal test`（至少跑 `orchestrator.test.ts`、`portal-locale.test.ts`、`deep-research-interaction-i18n.test.ts`、`chat-composer-i18n.test.ts`）
3. `pnpm -C enterprise/apps/web-portal typecheck`
4. 手动（`enterprise/scripts/start-dev.sh` 后打开 `http://localhost:3000/workspace`）：
   - 顶栏切 English，硬刷新
   - 开 Deep research，看芯片为 `Deep research` + `Auto`，菜单四选项英文
   - 发一条英文调研指令：旁白、冷启动 pill、车道行 `Search web | …`、拆解句为英文；车道 title 为英文
   - hover 用户气泡：`Copy` / `Multi-select` / `Edit`
   - 切回中文再发一条：旁白恢复「我先快速检索…」，操作条恢复「复制 / 多选」（证明默认 zh 未毁）

---

## 实施顺序与提交

按 Wave 1 → 5。每 Wave 可单独 commit。实施前把本文件从 `.cursor/plans/pending/` **移回** `.cursor/plans/2026-09-08-web-portal-deep-research-i18n.plan.md`。

```
Plan-Id: 2026-09-08-web-portal-deep-research-i18n
Plan-File: .cursor/plans/2026-09-08-web-portal-deep-research-i18n.plan.md
```
