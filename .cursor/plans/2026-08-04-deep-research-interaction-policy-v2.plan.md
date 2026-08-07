# 深度调研交互与交付优化计划（风险修订版）

Planned-with: kimi-k3（本次会话；基于 `2026-08-04-deep-research-interaction-policy.plan.md` 的风险重写）
Suggested-Impl-Model: GPT-5.x（跨 BFF、事件协议、运行状态与前端工作台的一致性改动；局部 UI/文案可拆给 composer-2.5-fast）
Status: Pending
Date: 2026-08-04
Plan-Id: 2026-08-04-deep-research-interaction-policy-v2

---

## 0. 一句话结论

不要假设「三变量契约 + 统一开题卡」就能满足大多数人对深度调研的期待。市场上其实同时存在三种「澄清哲学」和两种「交付哲学」，各自主打一个体验：

- **卡片式多轮澄清**（纳米类）：前 1–3 轮都可能弹卡片，边做边补问；
- **纯对话式澄清**（Gemini 类）：不弹卡片，模型用自然语言列几个「我打算这么做可以吗」，用户像聊天一样回几句，聊完直接开跑；
- **无澄清直接开跑**（Kimi / 智谱清言类）：用户一提就走，靠过程透明和结果兜底；
- **交付分野**：清言偏纯文本报告，Kimi 偏「能画图的报告」。

原 plan 把「卡片 + 计划可见性」当成唯一主交互，风险很高：**做了「卡片派」，同时可能丢掉「对话派」和「直接派」**，而且没解决 Kimi 式图表——后者才是用户现在最直观感知的「调研能力强」。

本 plan 的目标：**在现有 Portal 深研流水线上，同时支持卡片/对话/直跑三种澄清入口，把澄清轮次做成可预算的（最多 3 次、可运行中），并把交付从「文字 + 简单结构」升级为 Kimi 式「表格 + Mermaid 图 + 可扩展图表」**，而不是只改启动前交互。

---

## 1. 实质风险清单（原 plan 不会自动如意的地方）

| # | 风险 | 为什么原 plan 覆盖不足 | 后果 |
|---|---|---|---|
| R1 | **澄清形态单一**：只有卡片，没有对话式 | 原 plan 的 `ClarificationDecision` 只决定「问不问、最多两道题」，UI 是统一 Preflight Card | 习惯 Gemini 的用户觉得「被表单拦住」，习惯直接跑的用户觉得卡片啰嗦 |
| R2 | **澄清轮次固定为启动前一次** | 原 plan 只处理「启动前 gate」，运行中 steering 放到 Wave 4 且未细化 | 纳米类「边做边问 2–3 次」做不了；跑着才发现缺约束时只能硬跑到底 |
| R3 | **「对话式澄清」与卡片如何落同一套协议没定义** | 卡片是结构化 `questionId + options`，对话是纯文本；resume/route、事件协议、hydrate 都按卡片设计 | 做成两套运行时，重连/恢复/审计必然分叉 |
| R4 | **交付只到「结构化」** | 原 plan Out of scope 明确不重写报告写作与交付格式 | 用户现在已把 Kimi 的图当「深研能力强」的信号，只做表格+Mermaid 可能仍显单薄 |
| R5 | **复杂度/澄清/可见性三变量被误读为「用户体验三分法」** | 产品容易把 `light/standard/deep` 直接当成 UI 三档按钮 | 又退回「用户自己选深度」的老路，没解决「要不要问、怎么问」 |
| R6 | **运行中澄清与 steering 混为一谈** | 「运行中再澄清」和「运行中追加约束/暂停车道」是两件事 | 实现时把暂停/追加做成重规划，成本高、易出 bug |

---

## 2. 产品共识：把「澄清」拆成两个独立维度

在原有 `researchDepth` / `planVisibility` 之外，**把澄清从「一个决策」改成「两个独立变量」**：

```ts
export type ClarifyMode = "card" | "chat" | "none";
export type ClarifyPhase = "preflight" | "midrun";

export type ClarifyBudget = {
  /** 一轮 deep research 内允许的最大澄清次数（含启动前 + 运行中） */
  maxRounds: 1 | 2 | 3;
  /** 当前已用轮次 */
  usedRounds: number;
  /** 是否允许运行中补充澄清 */
  allowMidRun: boolean;
};

export type ClarifyStyle = {
  mode: ClarifyMode;
  /** card：走现有结构化问题；chat：走自然语言对话；none：直接跑 */
  blocking: boolean;
  /** 本阶段最多呈现几个问题/几段引导语 */
  maxItems: number;
};
```

约束：

1. `mode` 与「是否澄清」「澄清几次」解耦：卡片也可以只问一次，对话也可以问三次。
2. `maxRounds` 是运行级预算，默认 3；用户明确说「直接开始」时，`preflight` 可被跳过，但 `maxRounds` 不重置——运行中仍可补问。
3. `chat` 模式不弹卡片，但后端仍要把用户的自然语言回复**解析成结构化槽位**（地域/时间/对象/评价标准），否则 planner 无法消费。
4. `none` 不是「不评估」，而是评估后按默认假设直接跑，并在结果开头一句话说明范围。

---

## 3. 三种澄清形态如何统一落地

| 形态 | 触发方式 | UI | 后端协议 | 适用人群/场景 |
|---|---|---|---|---|
| **卡片式（多轮）** | `mode: "card"`，可 preflight + midrun | 现有 `DeepResearchClarifyCard` 复用；每轮一张卡，最多 3 张，可折叠 | `clarify` 事件 + `roundIndex`；resume 走现有 `/resume` | 约束强、喜欢点选、需要审计 |
| **对话式** | `mode: "chat"` | 不弹卡片，模型在消息流里发一条「我打算从 A/B/C 入手，可以吗？」；用户直接回复自然语言 | 新增 `clarify_chat` 事件（含 `promptText` + 解析后的 `slots`）；回复走普通消息，由 orchestrator 识别为澄清续跑 | 习惯 Gemini、愿意打字、怕表单 |
| **直接开跑** | `mode: "none"` 或用户选「直接开始」 | 无澄清 UI；结果开头显示「按以下默认范围研究：…」 | 无 clarify 事件，只落 `assumptions` | 明确知道自己要什么、低风险任务 |

关键：**后端只认「澄清轮次 + 结构化槽位」，不认 UI 形态**。卡片和对话最终都落成同一组 `slots`，保证 planner / run-store / hydrate 只有一份实现。

---

## 4. 运行中澄清（mid-run clarify）怎么做得不翻车

原 plan 把运行中 steering 放到很后面，且没区分「再澄清」和「追加约束」。本 plan 明确分两档：

### 4.1 允许做（P1）：运行中「轻量补充澄清」

- 触发：车道执行中发现关键槽位仍缺失（如比较对象只搜到一个、时间范围冲突、来源全是二手），且 `usedRounds < maxRounds` 且 `allowMidRun === true`。
- 行为：暂停**尚未启动的车道**（已完成的不动），发出 `clarify` 或 `clarify_chat`，拿到回答后更新 `ResearchPlanSnapshot.version` 再继续。
- 不做：不推翻已完成的来源/备忘/引用；不重新跑整轮 recon；不暂停写作阶段（写作阶段缺约束时按 assumptions 继续并在报告末尾说明）。

### 4.2 暂不做（P2+）：运行中任意 steering / 重规划

- 用户运行中说「别看这些来源了」「换成成本视角」→ 本 plan 不接管，仍走「完成后重跑」或后续 Wave 4。
- 原因：涉及车道级回滚、来源作废、预算重算，易把主流程搞复杂。

---

## 5. 交付优化：从「文字墙」到「Kimi 式能画图」

深研报告当前的最大短板是「篇幅够了，但几乎全是散文」：写作侧的大纲/分节 prompt 只约束章节数、引用和字数，从未要求对比矩阵、时间线或图；HTML 渲染侧所有 ``` 围栏一律变成 `<pre><code>`，即便模型写了 Mermaid 也只是灰色代码块。本 plan 把交付形态作为与澄清并列的主线，自成一套完整设计（FR-D1 ~ FR-D5），不依赖任何外部子计划。

### FR-D1 大纲声明表达形态

**文件**：`enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`

`ReportSection` 增加 `format` 字段：

```ts
export type SectionFormat =
  | "prose"
  | "comparison_table"
  | "timeline"
  | "mermaid"
  | "chart"
  | "tradeoff";

export type ReportSection = {
  id: string;
  title: string;
  brief: string;
  citationIndexes: number[];
  /** 本节主表达形态；缺省 prose */
  format: SectionFormat;
};
```

`OUTLINE_SYSTEM` 的 JSON schema 增加 `format`，并加硬约束：

```text
format 取值：prose | comparison_table | timeline | mermaid | chart | tradeoff
规则：
- 首节「核心结论」与末节「不确定性与信息缺口」必须 format=prose
- 主题涉及对比/选型/竞品 → 至少 1 节 comparison_table
- 主题涉及演进/版本/时间节点 → 至少 1 节 timeline
- 主题涉及架构/关系/流程 → 至少 1 节 mermaid（flowchart/mindmap/sequence）
- 主题含明显数值对比（市场规模/性能指标/份额） → 至少 1 节 chart
- 全篇中间节不得全部为 prose（至少 1 节为非 prose 形态）
```

`normalizeSection` 解析 `format`，非法值回落 `"prose"`；新增兜底校正函数：

```ts
export function ensureRichOutlineFormats(outline: ReportOutline): ReportOutline
```

若中间节（去掉首尾）全部为 `prose`，按主题关键词把第一个非首尾节强制改为 `comparison_table` / `timeline` / `mermaid` / `chart` 中最匹配者，并在 `brief` 末尾追加对应表达要求。在 `parseOutlineJson` / `buildReportOutline` 返回前调用。

### FR-D2 分节写作按 format 强制

**文件**：`report-writer.ts` 的 `buildSectionMessages`

新增按 format 追加的约束片段：

| format | 追加要求 |
|---|---|
| `comparison_table` | 必须含 ≥1 张 GFM 表（表头+分隔行+≥3 数据行）；列含可对比维度与证据 `[N]`；禁止用纯列表代替表 |
| `timeline` | 必须用 GFM 表或有序时间线列出 ≥4 个带时间/版本节点的事件，每行带 `[N]` |
| `mermaid` | 必须含一个 ```mermaid 代码块（flowchart/mindmap/sequence）；节点标签短；图后 3–6 句解读；禁止只写「如下图所示」而无代码块 |
| `chart` | 必须含一个 ```chart 代码块，内容为合法 chart spec JSON（见 FR-D4）；数据必须来自正文已引用的来源，禁止编造数值 |
| `tradeoff` | 必须含「方案 × 维度」对比表 + 一段「推荐/不推荐/风险」 |
| `prose` | 维持现有字数与引用要求；鼓励但不强制插小表 |

`buildSectionMessages` user 块增加一行：`本节表达形态：${section.format}`，并拼接对应 directive；Lead 节（`sectionIndex === 0`）忽略 format，仍用 lead 专用 system。

### FR-D3 HTML 渲染正文 Mermaid

**文件**：`enterprise/apps/web-portal/src/lib/deep-research/report-html.ts`

`markdownToHtml` 围栏分支：若 `lang`（小写）为 `mermaid`，输出与现有 mindmap 一致的结构（`div.mermaid-wrap > pre.mermaid` + 失败回退 `pre.mermaid-fallback`），复用既有 CSS 与回退脚本；其他语言仍输出 `<pre><code class="language-…">`。

脚本注入条件改为：

```ts
const bodyHasMermaid = /```mermaid\b/i.test(input.markdown);
const needMermaid = Boolean(input.mindmapMermaid.trim()) || bodyHasMermaid;
```

`needMermaid` 为真才注入 `mermaid.min.js`，`startOnLoad: true` 渲染页面上所有 `.mermaid`。

### FR-D4 数据图表（chart spec）

`chart` 节要求模型输出一段 fenced ```` ```chart ```` 代码块，内容为 JSON：

```json
{
  "type": "bar | line | pie | scatter",
  "title": "...",
  "x": ["..."],
  "series": [{ "name": "...", "data": [1, 2, 3] }]
}
```

渲染策略（按优先级，均不引入重型图表库）：

1. Mermaid `xychart-beta`：把 chart spec 翻译成 xychart 语法，走 FR-D3 同一渲染链路（离线打包零新增依赖）；
2. 内置轻量 SVG：bar/pie 各一个 <100 行的确定性渲染函数，作为 xychart 不支持类型或渲染失败的兜底；
3. 最终兜底：chart spec 渲染为 GFM 表（数据不丢，只丢图形）。

`markdownToHtml` 对 `lang === "chart"` 先按上述链翻译/渲染，全部失败时输出数据表。

### FR-D5 轻量结构校验（不阻断）

**文件**：`report-writer.ts`（新建小函数）

```ts
export function sectionMeetsFormat(section: ReportSection, body: string): boolean
```

- `comparison_table` / `tradeoff`：body 含 GFM 表头行（`|` + 下一行 `|---`）
- `timeline`：GFM 表 **或** ≥4 行有序/无序时间条目
- `mermaid`：含 `/```mermaid[\s\S]*?```/i`
- `chart`：含 `/```chart[\s\S]*?```/i` 且 JSON 可解析为合法 chart spec
- `prose`：恒 true

**接线**：`orchestrator.ts` 分节写作循环（写出 `sectionBody` 之后）调用；失败仅 `console.warn("[deep-research] section format miss", section.id, section.format)`，**不重试、不抛、不改 status**（先观测；重试留给后续波次）。

### 暂不做（后续 plan 评估）

类「地图/分布图/复杂信息图」的自由 SVG 或图片生成，成本高、易出错；先靠 Mermaid + chart 覆盖 80% 场景，其余用「来源卡片 + 表格」兜底，不硬上。

---

## 6. 技术落地设计（修订）

### 6.1 事件与状态协议

在 `enterprise/packages/sdk-ts/src/deep-research.ts` 与 `enterprise/packages/core-api/src/chat.ts` 上扩展（保持旧事件兼容）：

```ts
type ResearchProfileEvent = {
  type: "research_profile";
  runId: string;
  researchDepth: "light" | "standard" | "deep";
  clarifyMode: "card" | "chat" | "none";
  clarifyBudget: { maxRounds: number; allowMidRun: boolean };
  planVisibility: "hidden" | "preview" | "editable";
  assumptions: string[];
};

type ClarifyEvent = {
  type: "clarify";
  runId: string;
  roundIndex: number;           // 0 = preflight, 1..n = midrun
  phase: "preflight" | "midrun";
  mode: "card";
  questions: Array<{ id: string; label: string; options?: string[]; blocking: boolean }>;
};

type ClarifyChatEvent = {
  type: "clarify_chat";
  runId: string;
  roundIndex: number;
  phase: "preflight" | "midrun";
  mode: "chat";
  promptText: string;             // 模型发的自然语言引导
  /** 后端解析用户回复后得到的槽位，hydrate 用 */
  resolvedSlots?: Record<string, string>;
};

type ResearchPlanEvent = {
  type: "research_plan";
  runId: string;
  action: "proposed" | "updated" | "approved";
  version: number;
  plan: ResearchPlanSnapshot;
};
```

对 `ChatMessageDeepResearch` / `DeepResearchState` 增加：

```ts
profile?: ResearchInteractionProfile;
plan?: ResearchPlanSnapshot;
planVersion?: number;
clarify?: {
  mode: ClarifyMode;
  budget: ClarifyBudget;
  history: Array<{ roundIndex: number; phase: ClarifyPhase; mode: "card" | "chat"; slots: Record<string, string> }>;
};
assumptions?: string[];
```

状态统一为 `awaiting_input`，带 gate：

```ts
gate?: { type: "clarify_card" | "clarify_chat" | "plan" | "clarify_and_plan"; roundIndex: number };
```

旧 `awaiting_clarify` 继续识别为 `awaiting_input + clarify_card`（roundIndex 0），避免历史消息挂死。

### 6.2 意图/澄清评估器

新建 `enterprise/apps/web-portal/src/lib/deep-research/interaction-policy.ts`，在原 plan 基础上增加：

```ts
export function assessClarifyStrategy(input: {
  query: string;
  reconBrief?: string;
  userPreference?: "auto" | "direct" | "card_first" | "chat_first" | "plan_first";
  conversationHistory?: Array<{ role: string; content: string }>;
}): {
  mode: ClarifyMode;
  phase: ClarifyPhase;
  blocking: boolean;
  maxItems: number;
  reasonCodes: string[];
};

export function parseChatClarifyReply(input: {
  promptText: string;
  userReply: string;
  pendingSlots: string[];
}): Record<string, string>;
```

规则：

- 用户偏好 `chat_first` 或对话历史显示用户连续用自然语言回答 → `mode: "chat"`；
- 用户偏好 `card_first` 或高风险/多选项 → `mode: "card"`；
- 用户偏好 `direct` 且非高风险 → `mode: "none"`；
- `auto` 由「歧义 × 错误代价 × 打扰成本」决定，但默认给 `card` 一次，若用户回复「直接开始/你看着办」则下一轮自动切 `none`。

### 6.3 Orchestrator 接线

修改 `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`：

1. `runDeepResearchTurn` 完成 recon 后，先 `assessClarifyStrategy` 决定 `mode/phase/blocking`。
2. `preflight` 阶段：
   - `card`：沿用现有 clarify gate，但事件带 `roundIndex: 0`；
   - `chat`：发 `clarify_chat`，等待用户下一条普通消息作为回复，调用 `parseChatClarifyReply` 解析为 slots，再继续；
   - `none`：直接按 assumptions 继续。
3. `midrun` 阶段：每个车道启动前检查 `usedRounds < maxRounds && allowMidRun && 缺关键槽位`；命中则暂停未启动车道，发澄清（卡片或对话），拿到 slots 后 `plan.version++` 再继续。
4. 交付偏好不再无条件追加到阻塞问题；作为默认值或开题卡折叠区。
5. 计划可见性逻辑沿用原 plan（hidden / preview / editable），但 `editable` 的等待必须和澄清 gate 统一成 `awaiting_input`，避免多 gate 嵌套。
6. `researchDepth` 驱动预算：`light` 1–2 车道；`standard` 2–4；`deep` 4–8 + 全文抓取 + 反思。预算不足可降级，但必须在 `research_profile` 或完成摘要里说明。

### 6.4 Gate 与 resume

`run-wait.ts` 抽象为 `ResearchGate`，保留旧函数别名：

```ts
type ResearchGatePayload = {
  answers?: Record<string, string>;        // card 模式
  chatReply?: string;                     // chat 模式，由后端解析
  planAction?: "approve" | "edit" | "skip";
  planPatch?: Partial<ResearchPlanSnapshot>;
  skip?: boolean;
};
```

`enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`：

- 校验 `runId`、用户、当前 gate；
- `chatReply` 与 `answers` 互斥；同时提交 `planPatch` 时，先应用澄清结果，再生成新 plan version，原子落事件；
- 超时/重复提交幂等，返回 `alreadyContinued: true`，不向前端抛裸 JSON。

### 6.5 持久化与重连

第一版仍复用 `RunRecord.events` 持久化，不新增 DB 列：

- `run-store.ts` 的 `RunRecord.events` 存新事件；
- hydrate payload 从最新事件派生 `profile/plan/gate/clarify.history`；
- `deep-research-hydrate.ts` / `deep-research-reconnect.ts` 合并 `clarify_chat` 与 `research_plan`；
- `history-outbox.ts` 与 `sql-store.ts` 把新快照字段加入白名单；
- `chat-message-sanitize.ts` 增加字段长度、子问题数、假设数、版本号、轮次上限。

需要跨设备恢复用户澄清偏好时，再增加 PG/MySQL JSON 字段（两端同步迁移，不能只改 PG）。

### 6.6 前端工作台

新建/修改：

- `DeepResearchPreflightCard.tsx`：支持「关键问题 + 计划草案 + 直接开始/修改/确认」；
- `DeepResearchClarifyChat.tsx`：不弹卡片，在消息流里渲染 `clarify_chat` 的 promptText，并高亮「这条是深研澄清，直接回复即可」；
- `DeepResearchWorkbench.tsx` / `deep-research-segments.ts`：把 `research_profile → preflight/card/chat → research_plan → tools → delivery` 聚合成一条时间线，同一轮只渲染一张主卡；
- `DeepResearchClarifyCard.tsx`：保留兼容，支持 `roundIndex > 0` 的「第 2/3 轮澄清」折叠样式；
- `MachiChatView.tsx`：发送请求携带用户澄清偏好（`card_first/chat_first/direct/plan_first`）与当前任务临时覆盖；重试/重新生成保持一致；
- `features/chat/src/store.ts`：处理 `clarify_chat`、`research_plan`、`gate` 事件，维护 `usedRounds` 与 plan version。

视觉要求：

- 卡片澄清最多 3 张，默认折叠旧轮次，只展开当前轮；
- 对话澄清与普通消息区分（左侧边框/图标），但不打断消息流；
- 计划更新展示「变更了哪些方向」，不整份刷屏；
- `required` 问题附一句「为什么需要确认」，不展示内部评分。

---

## 7. 分阶段实施顺序

### Wave 0：契约与基线（P0）

- 新建 `interaction-policy.ts` + 纯函数测试；
- 扩展 SDK/Core API 的 `research_profile` / `clarify`（带 roundIndex）/ `clarify_chat` / `research_plan` 事件；
- 保留 `awaiting_clarify` 兼容，先不启用 chat/midrun；
- 记录分类指标与 reason codes，不记录原始 prompt/答案。

验收：同一输入的 depth/mode/phase/budget 可独立断言；旧客户端忽略新事件不崩溃；现有深研单测全绿。

### Wave 1：少打扰 + 多轮卡片澄清（P0）

- orchestrator 接入确定性 policy；
- `clarifier.ts` 只生成候选问题，由 policy 限制每轮最多 2 题、总轮次 ≤3；
- 运行中缺关键槽位时允许 midrun 卡片澄清（暂停未启动车道）；
- 交付偏好不再混排进阻塞问题。

验收：清楚深题不强制澄清；长 prompt 事实题不触发澄清；高风险缺槽至少问 1 轮；midrun 澄清后 plan version 递增；超时/重复提交行为不退化。

### Wave 2：对话式澄清 + 计划可见性（P0/P1）

- 新建 `DeepResearchClarifyChat` 与 `parseChatClarifyReply`；
- `chat_first` 用户默认走对话澄清；`auto` 在用户对卡片说「直接开始」后自动切 chat/none；
- `DeepResearchPreflightCard` 支持「澄清 + 计划」同卡；
- 用户偏好本地持久化，当前任务可临时覆盖。

验收：chat 模式无卡片、能正确解析回复为 slots；plan_first 可编辑并看到版本变化；刷新/重连/历史恢复后 profile/plan/clarify history 一致。

### Wave 3：研究深度预算 + 图表交付（P1）

- `resolveDepthBudget()` 收敛 `MAX_LANES`、结果数、正文抓取、反思阈值、写作预算；
- `light/standard/deep` 只控目标上限，不突破租户配额与安全限制；
- 交付形态落地 FR-D1 ~ FR-D5：大纲 `format` 字段、分节 directive、正文 Mermaid 渲染、chart spec 渲染链（xychart → 内置 SVG → 数据表兜底）、轻量结构校验；
- 预算不足降级时发事件并在完成摘要说明。

验收：相同 depth 下改 planVisibility 不改变车道预算；light 不启动 deep 车道；deep 不被 planner 压缩；含数值对比的主题至少 1 节 chart/table，HTML 可正常渲染。

### Wave 4：运行中 steering 与个性化（P2）

- 用户运行中追加「只看官方来源」「聚焦成本」等修正（暂停未启动车道）；
- 长期偏好统计，自动调整 planVisibility / clarifyMode 默认值；
- 高风险场景租户级强制澄清策略与来源白名单。

本波次不提前侵入 Wave 1–3 主流程。

---

## 8. 文件级改动清单与推荐实施模型

| 子任务 | 主要落点 | 推荐模型 | 理由 |
|---|---|---|---|
| policy 纯函数与测试 | 新建 `enterprise/apps/web-portal/src/lib/deep-research/interaction-policy.ts`；扩展 `research-intent.test.ts` / `clarifier.test.ts` | composer-2.5-fast | 规则、类型和单测为主，边界已写死 |
| 事件/状态协议 | `enterprise/packages/sdk-ts/src/deep-research.ts`、`enterprise/packages/core-api/src/chat.ts`、sanitize/history/hydrate | GPT-5.x | SDK、BFF、store、重连和历史协议必须一致 |
| orchestrator gate（含 midrun） | `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`、`run-wait.ts`、`resume/route.ts` | GPT-5.x | 触碰长任务状态、超时、预算和原子 resume |
| 对话式澄清解析 | `interaction-policy.ts` + `orchestrator.ts` chat 分支 | GPT-5.x | 自然语言 → 结构化槽位，需与 planner 对齐 |
| preflight + chat UI | 新建 `DeepResearchPreflightCard.tsx` / `DeepResearchClarifyChat.tsx`；改 `DeepResearchWorkbench.tsx` / `deep-research-segments.ts` / `DeepResearchClarifyCard.tsx` | composer-2.5-fast；视觉收口用强审美模型 | 组件接线局部，但注意等待/超时/计划 diff/多轮折叠 |
| 用户偏好接线 | `MachiChatView.tsx`、`WorkspaceShell.tsx`、`ComposerPlusMenu.tsx`、`features/chat/src/store.ts` | composer-2.5-fast | 现有 Popover、localStorage 和请求透传 |
| 深度预算控制 | `orchestrator.ts`、`planner.ts`、`orchestrator.test.ts` | GPT-5.x | 预算、车道、反思和报告收尾的序列一致性 |
| 图表交付（FR-D1 ~ FR-D5） | `report-writer.ts`、`report-html.ts`、`orchestrator.ts`（warn 接线）、相关测试 | GPT-5.x | 大纲约束 + 渲染链 + 校验，需兼顾离线打包与模型输出稳定性 |
| 灰度与最终回归 | 深研全量 Vitest、Portal typecheck、手动冒烟 | GPT-5.x | 跨层行为和兼容路径最终复核 |

---

## 9. 验收矩阵

### 9.1 决策矩阵（含澄清形态）

| 场景 | depth | clarify mode | phase | plan | 备注 |
|---|---|---|---|---|---|
| 「研究一下某模型核心技术演进」 | deep | card 或 chat（按用户偏好） | preflight 1 轮 | 按偏好 | 默认方向可直接采用 |
| 「比较 2024–2026 的 A/B/C，关注成本、Agent 能力，优先官方来源」 | deep | none | — | 按偏好 | 条件已明确，不再问 |
| 「帮我做 AI 战略建议」 | deep | card（高风险） | preflight 1–2 轮 | 若 plan_first 则同卡 | 问对象/期限/评价标准 |
| 长篇背景 + 「发布日期是什么」 | light | none | — | hidden/preview | 单一事实，不澄清 |
| 「推荐一款手机」 | light/standard | card 或 chat | preflight 1 轮 | hidden 默认 | 预算/地区改变结论 |
| 医疗/法律/投资决策，关键适用范围缺失 | 视工作量 | card | preflight + 可 midrun | preview/editable | 显示假设，必问关键约束 |
| 用户选「直接开始」但缺高风险关键条件 | 视工作量 | card（不可关闭） | preflight 1 轮 | 可 hidden | 先完成关键澄清再跑 |
| 运行中发现比较对象只搜到一个 | 视工作量 | card 或 chat | midrun（≤3 轮内） | version++ | 暂停未启动车道补问 |

### 9.2 必须新增的测试

- `interaction-policy.test.ts`：depth/mode/phase 解耦、长 prompt 不误触发、短描述深题不误跳过、高风险缺槽必问、chat 回复正确解析为 slots。
- `clarifier.test.ts`：模型返回长问卷时每轮最多保留 2 题；总轮次 ≤3；交付偏好不挤占额度。
- `orchestrator.test.ts`：`card/chat/none` × `preflight/midrun` 组合；事件顺序、等待状态、plan version、预算不变；midrun 澄清后未启动车道暂停、已启动车道不受影响。
- `run-wait.test.ts`：answers、chatReply、planPatch、超时、重复提交、HMR/文件轮询。
- `DeepResearchPreflightCard.test.tsx` / `DeepResearchClarifyChat.test.tsx`：同卡显示问题+计划；chat 回复后计划 diff；直接开始不阻塞；计划编辑只提交白名单字段。
- `deep-research-segments.test.ts`：`research_profile → preflight/chat → research_plan → tools → delivery` 聚合顺序；旧事件仍能渲染。
- `store.deep-research.test.ts`、`deep-research-hydrate.test.ts`、`deep-research-clarify-resume.test.ts`：新状态、版本、重连、历史恢复和旧状态兼容。
- `report-writer.test.ts`：`format` 解析与非法回落、`ensureRichOutlineFormats` 强制非 prose、`buildSectionMessages` 按 format 拼接 directive、`sectionMeetsFormat` 真假例。
- `report-html.test.ts`：正文 ```mermaid 渲染为 `.mermaid` 结构且注入 CDN、```chart 按「xychart → 内置 SVG → 数据表」链渲染、普通代码块不受影响。
- SDK/Core API 类型检查与 `chat-message-sanitize` 字段上限测试。

### 9.3 手动冒烟（至少 8 条）

1. 清楚的深题：deep 但不强制澄清；
2. 含糊的深题：只问一轮关键问题；
3. 简单明确事实题：light、无澄清、快速完成；
4. 简单但缺关键推荐条件：澄清由歧义/代价触发，而非深度触发；
5. `先看计划`：修改一个子问题，确认执行车道与计划版本一致；
6. 卡片澄清第 2 轮：midrun 补问后 plan version 递增；
7. 对话澄清：无卡片，模型发自然语言引导，用户回复后正确解析并继续；
8. 刷新/关闭页面/重开会话：运行、澄清（卡片/对话）、计划、产物均可恢复。

建议命令：

```bash
cd enterprise/apps/web-portal
pnpm vitest run src/lib/deep-research
pnpm vitest run ../../features/chat/src
pnpm typecheck
```

---

## 10. 指标与灰度

不记录原始 prompt、完整澄清答案或模型思维链，只记录分类事件：

- `research_profile_selected`：depth、clarifyMode、planVisibility、reason codes；
- `clarify_shown / clarify_submitted / clarify_skipped / clarify_timeout`（带 mode/phase/roundIndex）；
- `clarify_chat_prompt / clarify_chat_reply_parsed / clarify_chat_fallback_to_card`；
- `plan_shown / plan_edited / plan_approved / plan_skipped`；
- `research_started / first_lane_started / first_source / completed / cancelled / failed`；
- 完成后短时间内重问、修改目标或重跑的比例；
- 任务耗时、来源数、报告交付完成率、前端错误率；
- chart/mermaid 渲染失败率（若高，回退到 table/prose）。

灰度顺序：

1. 只上报 profile，不改 UI；
2. 内部/测试租户启用多轮卡片澄清；
3. 小流量开放对话式澄清；
4. 默认保持 `planVisibility: hidden`，给少量用户开放「先看计划」；
5. 对比「无谓澄清率」「澄清超时率」「结果后纠偏/重跑率」，不能只看澄清提交率；
6. 若 chat 模式解析失败率高或用户流失增加，回滚 chat/midrun，保留已有事件兼容代码。

---

## 11. 与已有计划的关系

本 plan 是**交互与交付的总修订**，不替代已有具体实现计划：

- `.cursor/plans/2026-07-27-enterprise-portal-deep-research.plan.md`：深研主流程；
- `.cursor/plans/2026-07-27-enterprise-portal-deep-research-workbench.plan.md`：工作台与过程展示；
- `.cursor/plans/2026-07-28-portal-deep-research-kimi-style-ux.plan.md`：可展开时间线与澄清卡；
- `.cursor/plans/2026-08-01-deep-research-clarify-timeout-ux.plan.md`：澄清超时、幂等和等待器；
- `.cursor/plans/2026-08-02-deep-research-p0-fulltext-longform.plan.md`：正文抓取与长报告；
- `.cursor/plans/2026-08-02-deep-research-llm-json-and-quality.plan.md`：LLM JSON 与写作质量；
- `.cursor/plans/2026-08-03-deep-research-clarify-delivery-prefs.plan.md`：交付偏好与单主产物；
- `.cursor/plans/2026-08-03-deep-research-lane-sources-panel.plan.md`：车道来源面板。

实施时先完成本 plan Wave 0/1 的契约与多轮/对话澄清决策逻辑，再把已有各子计划中的澄清、工作台和交付实现接到同一套 `profile/gate/plan/clarifyBudget` 语义上。禁止在不同计划中各自新增一套「复杂度」「模式」或「澄清状态」。

## 12. 边界与不做清单（no-scope-creep）

- 不重写搜索 provider、页面正文抓取、引用注册、报告写作质量；这些已有独立计划。
- 不改 Desktop、Python AgenticX runtime、Gateway 模型路由或管理后台。
- 不把模型内部思维链展示给用户；计划只展示可执行摘要、来源策略和假设。
- 不做运行中任意重规划/车道级回滚；先做「暂停未启动车道 + 轻量补充澄清」。
- 不引入重型图表库（Chart.js/ECharts）或自由 SVG/图片生成；先靠 Mermaid + 轻量 chart spec。
- 不把第三方产品名称写入 commit subject、PR 标题或 PR 正文；竞品名称仅保留在内部文档。
- 不新增公网 endpoint（第一版复用 `/resume`）；不立即新增 DB 列，先用事件持久化。
