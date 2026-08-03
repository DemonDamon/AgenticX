# 深研交付形态：对比表 / 时间线 / Mermaid（P0）

Planned-with: Opus 5
Suggested-Impl-Model: Composer 2.5（改动集中在 prompt + 轻量校验 + HTML mermaid 围栏识别，无跨栈高风险；够用且最省）

## 背景与根因

用户反馈深度研究报告「篇幅够了，但几乎全是散文，没有表、没有图」。对照现有代码：

- `report-html.ts` 的 `markdownToHtml`（约 L74–145）**已能渲染 GFM 表格**；` ``` ` 围栏一律变成 `<pre><code>`，**不会**把 ` ```mermaid ` 交给 Mermaid 引擎。
- 可视化报告顶部的思维导图来自 `buildMindmap`（大纲树），与正文无关；且 `mermaid.min.js` 仅在 `mindmapMermaid` 非空时注入（`report-html.ts` 约 L416–417）。
- 写作侧 `OUTLINE_SYSTEM` / `SECTION_SYSTEM`（`report-writer.ts` L33–58）只要求章节数、引用与字数，**从未要求**对比矩阵、时间线或图——模型自然写成文字墙。

本 P0 只治「全是字」：让大纲声明表达形态，分节按形态写，HTML 真正渲染正文里的 Mermaid。不做课题框架路由（P1）、不做置信度体系（P2）、不接外部专业 MCP（P3）。

## In scope

- FR-1：大纲增加 `format` 字段，并保证至少一类结构化章节
- FR-2：分节写作按 `format` 强制表 / 时间线 / Mermaid
- FR-3：HTML 将正文 ` ```mermaid ` 渲染为图，并按需加载 Mermaid
- FR-4：轻量结构校验（缺表/缺图时记 warn，不阻断落盘）

## Out of scope（no-scope-creep）

- 不改检索 / page-fetch / archive / completion-summary / 收尾兜底
- 不新增「课题类型 → 框架路由」（属 P1）
- 不做置信度/一手二手标注（属 P2）
- 不引入 Chart.js / 自定义 SVG 自由绘制 / 交互 widget
- 不改 Desktop；范围仅 `enterprise/apps/web-portal` 深研报告链路（+既有 HTML 产物）
- 不重构 orchestrator 阶段划分

---

## FR-1 大纲 `format` 字段

**文件**：`enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`

### 类型（约 L12–25）

before：`ReportSection` 仅有 `id/title/brief/citationIndexes`。

after：

```ts
export type SectionFormat =
  | "prose"
  | "comparison_table"
  | "timeline"
  | "mermaid"
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

### `OUTLINE_SYSTEM`（约 L33–40）

在现有 JSON schema 上增加 `format`，并加硬约束：

```
格式：{"title":"...","sections":[{"id":"s1","title":"...","brief":"...","citation_indexes":[1,4,7],"format":"prose"}]}
format 取值：prose | comparison_table | timeline | mermaid | tradeoff
规则：
- 首节「核心结论」与末节「不确定性与信息缺口」必须 format=prose
- 中间章节按证据选择形态；若主题涉及对比/选型/竞品，至少 1 节 comparison_table
- 若主题涉及演进/版本/时间节点，至少 1 节 timeline
- 若主题涉及架构/关系/流程，可有 1 节 mermaid（flowchart 或 mindmap）
- 全篇中间节不得全部为 prose（至少 1 节为 comparison_table / timeline / mermaid / tradeoff 之一）
```

### `normalizeSection`（约 L86–106）

解析 `format`；非法值回落 `"prose"`。`defaultOutline` 中间节改为 `format: "comparison_table"`（保证回落大纲也不是纯散文）。

### 兜底校正（新建小函数，同文件）

```ts
export function ensureRichOutlineFormats(outline: ReportOutline): ReportOutline
```

若中间节（去掉首尾）全部为 `prose`，把第二节（或第一个非首尾节）强制改为 `comparison_table`，并在 `brief` 末尾追加一句「请用 Markdown 对比表呈现关键维度」。在 `parseOutlineJson` / `buildReportOutline` 返回前调用。

**AC-1**：`report-writer.test.ts`
- 解析含 `format: "timeline"` 的 JSON → `sections[i].format === "timeline"`
- 全 prose 中间节 → `ensureRichOutlineFormats` 后至少一节非 prose
- `defaultOutline` 中间节 format 为 `comparison_table`

---

## FR-2 分节写作按 format 约束

**文件**：`report-writer.ts` 的 `buildSectionMessages`（约 L141–175）与 system 常量区

### before

`sectionIndex === 0` 用 `LEAD_SECTION_SYSTEM`，否则统一 `SECTION_SYSTEM`（只推字数）。

### after

1. 保留 lead / 默认 prose 两套。
2. 新增按 format 追加的约束片段（常量或 `formatDirectives: Record<SectionFormat, string>`）：

| format | 追加要求（写入 system 或 user） |
|---|---|
| `comparison_table` | 必须含 ≥1 张 GFM 表（表头+分隔行+≥3 数据行）；列含可对比维度与证据 `[N]`；表后可有简短解读，禁止用纯列表代替表 |
| `timeline` | 必须用 GFM 表或有序时间线列出 ≥4 个带时间/版本节点的事件，每行带 `[N]` |
| `mermaid` | 必须含一个 ` ```mermaid ` 代码块（flowchart 或 mindmap）；节点标签短；图后 3–6 句解读；禁止只写「如下图所示」而无代码块 |
| `tradeoff` | 必须含「方案 × 维度」对比表 + 一段「推荐/不推荐/风险」 |
| `prose` | 维持现有字数与引用要求；**鼓励**在合适处插入小表，但不强制 |

3. `buildSectionMessages` user 块增加一行：`本节表达形态：${section.format}`，并拼接对应 directive。

Lead 节（`sectionIndex === 0`）忽略 format，仍用 `LEAD_SECTION_SYSTEM`。

**AC-2**：`buildSectionMessages` 对 `format: "comparison_table"` 的 system/user 含「GFM」或「对比表」关键字；对 `mermaid` 含 ` ```mermaid `；lead 节即使 format 被误标也不含「必须含一个」类硬约束。

---

## FR-3 HTML 渲染正文 Mermaid

**文件**：`enterprise/apps/web-portal/src/lib/deep-research/report-html.ts`

### `markdownToHtml` 围栏分支（约 L91–104）

before：所有 fence → `<pre><code class="language-…">`。

after：若 `lang`（小写）为 `mermaid`：

```html
<div class="mermaid-wrap">
  <pre class="mermaid">…escaped source…</pre>
  <pre class="mermaid-fallback" hidden>…escaped source…</pre>
</div>
```

与 `renderMindmap` 结构一致，复用既有 CSS / 失败回退脚本。

### 脚本注入条件（约 L416–417）

before：仅 `mindmapMermaid.trim()` 为真时加载 CDN。

after：

```ts
const bodyHasMermaid = /```mermaid\b/i.test(input.markdown);
const needMermaid = Boolean(input.mindmapMermaid.trim()) || bodyHasMermaid;
```

`needMermaid` 为真才注入 `mermaid.min.js`。初始化逻辑保持 `startOnLoad: true`（页面上所有 `.mermaid` 一并渲染）。

**AC-3**：`report-html.test.ts`
- 输入含 ` ```mermaid\nflowchart LR\n  A-->B\n``` ` 的 markdown → HTML 含 `class="mermaid"`，且**不是**仅 `language-mermaid` 的 code 块
- 无 mindmap、仅正文 mermaid → 输出仍含 mermaid CDN script
- 普通 ` ```ts ` 仍为 `<pre><code class="language-ts">`

---

## FR-4 轻量结构校验（不阻断）

**新建**（或放 `report-writer.ts` 底）：

```ts
export function sectionMeetsFormat(section: ReportSection, body: string): boolean
```

- `comparison_table` / `tradeoff`：body 含 GFM 表头行（`|` + 下一行 `|---`）
- `timeline`：GFM 表 **或** ≥4 行有序/无序时间条目（启发式即可，测例写死）
- `mermaid`：含 `/```mermaid[\s\S]*?```/i`
- `prose`：恒 true

**接线**：`orchestrator.ts` 分节写作循环（写出 `sectionBody` 之后，约 L1230 附近）调用；失败仅 `console.warn("[deep-research] section format miss", section.id, section.format)`，**不重试、不抛、不改 status**（P0 先观测；重试留给后续）。

**AC-4**：单测 `sectionMeetsFormat` 真假例各一条；orchestrator 现有测试不因 warn 失败。

---

## 验收命令

```bash
cd enterprise/apps/web-portal
pnpm vitest run src/lib/deep-research/report-writer.test.ts \
  src/lib/deep-research/report-html.test.ts \
  src/lib/deep-research/orchestrator.test.ts
pnpm typecheck   # 仅确认无新增 deep-research 相关错误
```

手动冒烟：跑一轮「A vs B 技术选型」类深研 → `final-report.md` 中可见 Markdown 表；打开可视化 HTML → 表与（若有）Mermaid 图可见，而非灰代码块。

## 子任务 → 推荐实施模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1/FR-2 report-writer + 测试 | Composer 2.5 | 类型与 prompt，模式清晰 |
| FR-3 report-html mermaid 围栏 | Composer 2.5 | 局部 HTML 变换，已有 mindmap 可抄 |
| FR-4 校验 + orchestrator warn | Composer 2.5 / Kimi Code | 几行接线 |
| 联调收口（若 prompt 效果不稳） | GPT-5.x | 仅当需要收紧 directive 文案时升级 |
