# 深研澄清：交付形态 + 主格式选型；收尾对齐单产物卡片

Planned-with: cursor-grok-4.5
Suggested-Impl-Model: `composer-2.5-fast`（澄清固定题 + 解析 prefs + summary/交付去重；无跨栈高风险）
Parent / Related:
- `.cursor/plans/2026-08-02-deep-research-chat-completion-summary.plan.md`（聊天区只留摘要）
- `.cursor/plans/2026-08-02-deep-research-rich-deliverables.plan.md`（章节 format：表/时间线/Mermaid）

---

## 0. 一句话

澄清阶段让用户选定「内容性质 + 主交付格式」；收尾聊天区对齐对照产品：一段摘要 + **一张主文件卡 + 全部文件**，不再并列展示「终稿 / Markdown / 可视化报告」三份等价入口。

## 1. 根因与证据链

### 证据 1：三份「调研产物」链接来自同一轮收尾，内容高度重叠

| 标题后缀 | 路径 | 写入点 |
|---|---|---|
| · 终稿 | `research/<runId>/final-report.md` | `orchestrator.ts` synthesize 后（约 L1310） |
| · Markdown | `research/<runId>/report.md` | `finalize-report-artifacts.ts` L149–154（linkify 副本） |
| · 可视化报告 | `research/<runId>/report.html` | 同文件 L155–160 |

`fallbackSummary` / LLM summary 的「产物」块会把 `input.artifacts` **全列**（`completion-summary.ts` L111–114、SUMMARY_SYSTEM 第 3 条），于是聊天出现三条蓝链。

### 证据 2：交付条已在做「主卡去重」，与摘要矛盾

`DeepResearchDelivery.tsx` `isPrimaryDeliveryArtifact`（L60–66）已隐藏 `report.md` / `report.html`，只留 `final-report.md` 卡片 +「全部文件」+ 导出条。  
**摘要仍列三份 → 用户感知「一定要有三个」。**

### 证据 3：澄清只问方向，不问交付

`clarifier.ts` 最多 2 题、偏「更想了解哪些方向」；`DeepResearchClarifyCard` 一律多选。  
没有「结构化报告 / 对比矩阵 / 可视化 / 决策建议」或「md / html / docx / pdf」固定题。  
`applyClarifyAnswers` 仅把答案拼进 `userQuery` 文本，**不驱动** `finalizeReportArtifacts` 写哪些文件。

### 证据 4：导出能力已具备，但未进澄清

`GET .../export?format=html|md|docx` + 交付条「打印 / 存为 PDF」（浏览器 print，**无服务端真 PDF**）。  
用户要的「主格式」应在澄清选定，收尾只强调那一个。

## 2. 产品决策（写死，实施勿再猜）

### 2.1 聊天完成态（对齐图 1）

- 摘要正文：**禁止**再列 2+ 条等价报告链接；最多提一次主产物（或完全不提，交给下方卡片）。
- 交付区：`[主文件卡：可读标题.md/.html] + [全部文件]`；导出条保留，但默认高亮用户选的主格式。
- `report.md` 与 `final-report.md` 对用户视为同一份 Markdown：**摘要与主卡只暴露一份**。

### 2.2 澄清固定题（在 LLM/默认方向题之后追加，始终出现）

即使 clarifier `needed: false`，只要跑澄清阶段或「开放题默认澄清」，仍要注入下面两题（见 FR-1）。  
若整段跳过澄清（`skip` / 超时）：使用 **Default prefs**（§2.4）。

**题 A — `q_delivery_shape`（可多选）**

文案示例：

> 调研结果希望以哪些内容形态呈现？（可多选）

选项（id 固定）：

| id | label |
|---|---|
| `structured` | 结构化报告——完整论证链 |
| `matrix` | 对比矩阵 / 时间线——一眼看清关键差异 |
| `viz` | 数据可视化——趋势与结构关系（图表 / 图示） |
| `decision` | 决策建议——推荐什么、不推荐什么、风险在哪 |

**题 B — `q_delivery_format`（单选）**

文案示例：

> 最终主交付格式？（请选一个）

| id | label | 落地含义 |
|---|---|---|
| `md` | Markdown（.md） | 主卡 = 终稿 md；默认不强制打开 html |
| `html` | 可视化网页（.html） | 主卡 = report.html；md 仍落盘供导出 |
| `docx` | Word（.doc） | 主卡仍为 md（可预览）；完成态引导「下载 Word」；不另造第三份正文 artifact |
| `pdf` | PDF（打印导出） | 同 html 落盘；完成态引导「打印 / 存为 PDF」（诚实：浏览器打印，非服务端 PDF 引擎） |

### 2.3 与 rich-deliverables 的关系

题 A 的选项映射到大纲/分节 `SectionFormat` 偏好（依赖或并行 `.cursor/plans/2026-08-02-deep-research-rich-deliverables.plan.md`）：

| shape id | 偏好 |
|---|---|
| `structured` | 默认 prose 论证；至少保留结论 + 缺口节 |
| `matrix` | ≥1 节 `comparison_table` 或 `timeline` |
| `viz` | ≥1 节 `mermaid`（或等价图表围栏） |
| `decision` | ≥1 节 `tradeoff` / 明确「推荐 / 不推荐 / 风险」 |

若 rich-deliverables 尚未合入：本 plan **仍可先做**澄清 UI + prefs 持久化 + 摘要/主卡去重；把 prefs 写入 `userQuery` 的【用户澄清】与 run metadata，供写作 prompt 软约束（`report-writer` system 追加一段「用户偏好形态」）。硬 format 字段留给 rich-deliverables。

### 2.4 Default prefs（跳过 / 超时）

```ts
{ shapes: ["structured"], format: "md" }
```

## 3. In scope / Out of scope

### In scope

- FR-1：澄清追加固定题 + 前端单选支持
- FR-2：解析并持久化 `DeliveryPrefs`（run-store / resume answers）
- FR-3：写作 / finalize 按 prefs 决定「主产物」与是否强调 html
- FR-4：completion summary + 交付卡对齐「单主产物」体验
- 单测：clarifier append、prefs parse、summary 过滤、delivery primary 选择

### Out of scope（违反即回退）

- 不引入服务端 PDF 引擎 / 真 `.docx` npm 包（继续 Word-HTML `.doc` + 浏览器打印）
- 不改 Desktop；范围仅 `enterprise/apps/web-portal` + `enterprise/features/chat`
- 不做交互式 widget / Chart.js / 外部专业 MCP
- 不删除「全部文件」面板内的次要文件（用户仍可在文件树看到 html/md）
- 不改检索 / lane / page-fetch 核心逻辑
- 不在 commit / plan 文件名中写第三方品牌对标文案（实现注释可用中性「对照产品」）

---

## 4. FR-1：澄清固定题 + 单选 UI

### 4.1 类型与工厂

**新建** `enterprise/apps/web-portal/src/lib/deep-research/delivery-prefs.ts`：

```ts
export type DeliveryFormat = "md" | "html" | "docx" | "pdf";
export type DeliveryShapeId = "structured" | "matrix" | "viz" | "decision";

export type DeliveryPrefs = {
  shapes: DeliveryShapeId[];
  format: DeliveryFormat;
};

export const DELIVERY_SHAPE_QUESTION_ID = "q_delivery_shape";
export const DELIVERY_FORMAT_QUESTION_ID = "q_delivery_format";

export const DEFAULT_DELIVERY_PREFS: DeliveryPrefs = {
  shapes: ["structured"],
  format: "md",
};

export function deliveryClarifyQuestions(): ClarifyQuestion[]; // 返回题 A/B，含固定 options
export function parseDeliveryPrefs(
  answers: Record<string, string>,
  questions: ClarifyQuestion[],
): DeliveryPrefs;
export function deliveryPrefsPromptBlock(prefs: DeliveryPrefs): string;
export function pickPrimaryArtifactPath(
  runId: string,
  prefs: DeliveryPrefs,
): { pathSuffix: string; titleSuffix: string };
```

`ClarifyQuestion` **扩展**（`clarifier.ts`）：

```ts
export type ClarifyQuestion = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  allowCustom?: boolean;
  /** default true；false = 单选（点选切换，不可叠多个） */
  multiSelect?: boolean;
};
```

SSE `clarify` 事件需透传 `multiSelect`（查 `@agenticx/sdk-ts` / core-api `DeepResearchEvent` 类型；若缺字段则同步加 optional，旧前端忽略即可）。

### 4.2 注入时机

**改** `orchestrator.ts` 澄清分支（约 L659–681）：

```ts
const clarifyQuestions = [
  ...clarifyResult.questions,
  ...deliveryClarifyQuestions(),
].slice(0, 4); // 方向题最多 2 + 固定 2；若 needed:false 则仅固定 2
```

当 `clarifyResult.needed === false` 时：仍 enqueue 固定 2 题并 `awaiting_clarify`（产品要求：交付选型必问）。  
**例外**：若产品后续要「极短事实题零澄清」，可加 `looksOpenEndedResearchQuery` 门闩——本 plan **默认凡进深研 orchestrator 都问交付 2 题**；若与「事实题不澄清」冲突，则仅当 `looksOpenEndedResearchQuery(originalUserQuery) || clarifyResult.needed` 时注入。  
**本 plan 选定**：`needed: false` 且非开放题 → **不**注入交付题，用 Default prefs；开放题或 needed → 注入。

`normalizeQuestions` 的 `out.length >= 2` **不要**截掉后续固定题（固定题在 orchestrator 拼接，不经 normalize 截断）。

### 4.3 前端单选

**改** `DeepResearchClarifyCard.tsx`：

- 读 `q.multiSelect !== false` 为多选；`multiSelect === false` 时 `toggleOption` 改为单选（点 A 清掉同题其他）。
- 题头副文案：多选显示「可多选」，单选显示「请选一个」。
- 透传事件字段：确认 `ClarifyEvent` 类型含 `multiSelect?`。

**AC-1**：

- `delivery-prefs.test.ts`：`parseDeliveryPrefs` 多选 shape + 单选 format；空答案 → default。
- `DeepResearchClarifyCard` 单测或轻量逻辑测：format 题选第二个会清掉第一个。
- 开放题跑通后 events 含 `q_delivery_shape` 与 `q_delivery_format`。

---

## 5. FR-2：prefs 持久化与写作软约束

### 5.1 解析

澄清 resume 后：

```ts
const deliveryPrefs = parseDeliveryPrefs(resume.answers, clarifyQuestions);
// skip / timedOut → DEFAULT_DELIVERY_PREFS
```

写入 run-store（若 `DeepResearchRun` / metadata 有扩展位则加 `deliveryPrefs`；否则至少拼进 `applyClarifyAnswers` 的【用户澄清】，并在 synthesize 前局部变量持有）。

推荐：`run-store` patch `meta.deliveryPrefs`（JSON），hydrate 时可回读——便于刷新后交付主卡仍正确。

### 5.2 Prompt

`deliveryPrefsPromptBlock(prefs)` 示例：

```
【交付偏好】
- 内容形态：对比矩阵/时间线、决策建议
- 主格式：可视化网页（html）
写作时优先满足上述形态；完整论证链不可省略核心结论与信息缺口。
```

接入点：

- `planFn` / `outline` / `buildSectionMessages` 的 system 或 user 前缀（`report-writer.ts`）；最小改动：在 `orchestrator` 把 block 追加到 `userQuery`（已有【用户澄清】）——**可接受为 P0**；更干净是 outline/section 专用参数。

**AC-2**：`parseDeliveryPrefs` + prompt block 单测快照；orchestrator 在 skip 时 prefs === default。

---

## 6. FR-3：finalize / 主产物策略

**改** `finalize-report-artifacts.ts` + orchestrator 调用处：

1. **始终**写 `final-report.md`（写作真相源，不变）。
2. **`report.md`**：停止再写一份副本（或写但 `kind`/`title` 不进 summary 候选）。本 plan 选定：**不再 write `report.md`**，export `format=md` 直接读 `final-report.md`（`export/route.ts` 已有该 fallback）。
3. **`report.html`**：
   - `format === "html" | "pdf"` → 必须写；
   - `format === "md" | "docx"` → 仍可写（供「全部文件」与导出），但**不进摘要链接、不作主卡**。
4. 主卡选择：`pickPrimaryArtifact`：
   - md/docx → `final-report.md`，标题用大纲 title（如 `DeepSeek V4 核心技术点.md`），去掉「· 终稿 / · Markdown」后缀噪声；
   - html/pdf → `report.html`，标题 `…可视化报告` 或 `….html`。

**AC-3**：

- `finalize-report-artifacts.test.ts`：不再出现 `report.md` path。
- `export/route.ts` md 仍 200（读 final-report）。
- orchestrator 测试：artifacts 含 final-report；html 按需。

---

## 7. FR-4：摘要与交付 UI

### 7.1 completion-summary

**改** `completion-summary.ts`：

- 新增 `selectSummaryArtifacts(artifacts, prefs) →` 仅主产物（+ 非 report 类附件若有）。
- `SUMMARY_SYSTEM` 第 3 条改为：产物链接 **至多 1 个**主报告；不要罗列 md/html 双份；其余引导「见下方交付卡片」。
- `fallbackSummary` 同步。

**AC-4**：`completion-summary.test.ts` 三 artifact 输入 → 输出仅 1 条 `artifact:` 报告链。

### 7.2 DeepResearchDelivery

- 主卡标题：优先 artifact.title；若仍是 `… · 终稿`，展示时 strip ` · 终稿| · Markdown| · 可视化报告`，文件名用 path basename 或 `${outlineTitle}.md`。
- `isPrimaryDeliveryArtifact`：按 prefs / path 只留主卡（html 主格式时主卡为 html，不显示 final-report 卡；md 主格式反之）。
- 导出条：主格式对应按钮可加轻微强调（`text-foreground`），其余保持次级；不删除四按钮（用户仍可改下别的格式）。

**AC-5**：features/chat 单测或组件测：prefs=html 时 delivery 主卡 path 含 `report.html`；摘要无三条链接。

---

## 8. 子任务 → 推荐实施模型

| 子任务 | Suggested-Impl-Model | 理由 |
|---|---|---|
| `delivery-prefs.ts` + 单测 | composer-2.5-fast | 纯函数 |
| clarifier 类型 + orchestrator 注入 | composer-2.5-fast / kimi-k2.7-code | 接线样板 |
| ClarifyCard 单选 UI | composer-2.5-fast | 局部交互 |
| finalize 停写 report.md + export 回归 | composer-2.5-fast | 明确 |
| summary / Delivery 主卡去重 | composer-2.5-fast | 前端+字符串 |
| 与 rich-deliverables 硬 format 联调 | gpt-5.x 档（若已合入需收口） | 跨文件一致性 |

---

## 9. 实施顺序（建议 commit 粒度）

1. `delivery-prefs` + 事件/类型 `multiSelect` + ClarifyCard 单选  
2. orchestrator 注入固定题 + prefs 解析 / 默认  
3. 停写 `report.md` + export/summary 过滤 + Delivery 主卡  
4. （可选同 PR 或下个）prefs → report-writer 软约束；再接 rich-deliverables 硬 format  

每步可独立 `vitest`：  
`delivery-prefs.test.ts`、`clarifier`/`orchestrator` 相关、`completion-summary.test.ts`、`finalize-report-artifacts.test.ts`、chat 侧 clarify/delivery 测。

---

## 10. 手动验收

1. 开放题触发澄清 → 见到方向题（若有）+「内容形态」+「主交付格式」。  
2. 选「对比矩阵」+「可视化网页」→ 确认后检索；完成后聊天：**无三条蓝链**；一张 html 主卡 + 全部文件；导出条可用。  
3. 选 Markdown → 主卡为 `.md`；文件树里可有 html 但不进摘要。  
4. 跳过澄清 → 默认 md 主卡，行为与今类似但无三链噪音。  
5. 刷新会话：主卡与 prefs 一致（若做了 meta 持久化）。

---

## 11. Composer 自检清单（plan 合格线）

- [x] 精确落点：文件 + 函数/行号锚点  
- [x] before/after 意图（三链 → 单主卡；固定澄清题）  
- [x] 根因证据链自洽  
- [x] FR + AC 可执行  
- [x] In/Out of scope  
- [x] PDF/docx 能力边界写死（防实施模型承诺真 PDF）
