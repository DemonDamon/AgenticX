# 深度调研：LLM JSON 解析剥离 think + 报告质量收口

Planned-with: Opus 5
Suggested-Impl-Model: GPT-5.x（跨 5 个解析点 + 预算重排，属序列/一致性敏感改动，不宜用弱模型）

## 背景与根因证据链

用户反馈两个现象：(1) 深度调研收尾只剩一个 `Thinking` 折叠卡片，没有完成摘要正文；(2) 导出的 `final-report.md` 质量不高——只有 3 节，且最后一节被 `> 报告因时间预算截断` 掐掉，实际只写了 2 节，两节内容（MoE / MLA / MTP / FP8 / EP / 成本）高度重复。

经排查，二者是**同一个根因**：glm-5.x 等模型会在输出前带 `<think>…</think>`，而本仓库只在**报告正文**做了 `stripThinkBlocks`（`orchestrator.ts:1192` 与 `orchestrator.ts:1242`），**所有 LLM JSON 解析点与收尾摘要都没有剥离 think**。

失败点与回落后果：

| 解析点 | 文件:行 | 现状 | think 污染后的回落 |
|---|---|---|---|
| 报告大纲 | `report-writer.ts:105` | `JSON.parse(stripJsonFence(raw))`，`stripJsonFence` 只剥 ``` 围栏 | `defaultOutline()` 恰好 3 节（核心结论/分项分析/不确定性与信息缺口），本应 `MIN_SECTIONS=5` ~ `MAX_SECTIONS=9` |
| 研究计划 | `planner.ts:113` | 裸 `JSON.parse(raw)`，兜底 `objectMatch = /\{[\s\S]*\}/` 贪婪匹配，think 内含 `{` 即污染 | 单条 subQuestion → 「只有 1 条调研车道」 |
| 澄清 | `clarifier.ts:95` | 同上 | `{ needed: false }` → 「不做澄清了」 |
| 反思补搜 | `reflector.ts:36` | `stripFence` 无 think 处理，无兜底 | 返回空 gaps，迭代反思失效 |
| 查询扩写 | `query-expander.ts:75` | 同上 | 回落 `heuristicVariants`，关键词扩写失效 |
| 收尾摘要 | `completion-summary.ts:100` | 未剥 think，且**先 `truncate` 到 1600 字** | think 超长时截断后只剩思考文本，前端 `parseAssistant` 解析为 reasoning block，displayContent 为空 → 只剩 `Thinking` 卡片 |

大纲回落到 3 节后，`TOTAL_BUDGET_MS = 600_000`（10 分钟，`orchestrator.ts:75`）又在第 3 节前耗尽，触发 `orchestrator.ts:1205` 的截断分支，最终只有 2 节；而 `SECTION_TARGET_CHARS = 1_500` 要求每节 ≥1500 字，模型只能把同一批素材反复铺陈——这就是「重复、质量不高」的直接来源。

## In scope

- FR-1 统一 LLM JSON 前处理工具，替换 5 处解析点
- FR-2 收尾摘要剥离 think
- FR-3 时间预算提到 20 分钟并为写作阶段预留配额
- FR-4 首节「核心结论」写作定位修正

## Out of scope（no-scope-creep 边界）

- 不改检索后端 / page-fetch / archive 相关逻辑
- 不改前端 `DeepResearchDelivery.tsx` 等 UI 组件
- 不改 `run-store` / `artifact-store` 持久化结构
- 不重构 `orchestrator.ts` 的阶段划分与事件协议
- 不动 `enterprise/apps/web-portal` 之外任何目录

---

## FR-1 统一 LLM JSON 前处理

**新建** `enterprise/apps/web-portal/src/lib/deep-research/llm-json.ts`：

```ts
import { stripThinkBlocks } from "./content-clean";

/** 从可能带 <think>、```json 围栏、前后散文的 LLM 输出里提取并解析 JSON。失败返回 null。 */
export function parseLlmJson<T = unknown>(raw: string): T | null;

/** 仅做文本前处理（剥 think + 剥围栏 + 截取首个平衡 JSON 片段），供已有多级兜底链复用。 */
export function extractJsonText(raw: string): string;
```

`extractJsonText` 顺序：
1. `stripThinkBlocks(raw)`（含未闭合 `<think>` 的情况，`content-clean.ts` 已处理）
2. 剥 ` ```json … ``` ` / ` ``` … ``` ` 围栏（沿用现有正则语义，但不要求围栏必须在首尾）
3. 若剩余文本前后仍有散文，用**平衡括号扫描**（计数 `{}` / `[]`，跳过字符串字面量与转义）取第一个完整的 `{…}` 或 `[…]`；扫描不到则原样返回

`parseLlmJson` = `extractJsonText` → `JSON.parse` → `catch` 返回 `null`。

**改造落点**（只替换解析入口，不动各自的字段归一化逻辑）：

- `report-writer.ts:102 parseOutlineJson`：`JSON.parse(stripJsonFence(raw))` → `parseLlmJson<Record<string, unknown>>(raw)`，为 `null` 时走 `fallback`。可删除现已无用的本地 `stripJsonFence`（`report-writer.ts:74`）。
- `planner.ts:104 parseResearchPlanJson`：保留 `tryParse` 多级链，但在 `const trimmed = text.trim()`（`planner.ts:133`）之前先 `const cleaned = extractJsonText(text)`，后续链路基于 `cleaned`。
- `clarifier.ts:92 parseClarifierJson`：同 planner，在 `clarifier.ts:105` 处先 `extractJsonText`。
- `reflector.ts:34 parseGapsJson`：`JSON.parse(stripFence(raw))` → `parseLlmJson`，`null` 时返回 `[]`；删除本地 `stripFence`。
- `query-expander.ts:72 parseVariantsJson`：`JSON.parse(stripFence(raw))` → `parseLlmJson`，`null` 时返回 `fallback`；本地 `stripFence` 若无其它引用一并删除。

**AC-1**：新建 `llm-json.test.ts`，断言 `parseLlmJson` 能处理：纯 JSON、` ```json ` 围栏、`<think>思考{"a":1}</think>{"b":2}`（须得到 `{b:2}`）、未闭合 `<think>` 后跟 JSON、JSON 前后带散文、字符串字面量内含 `}` 的对象；非法输入返回 `null`。
**AC-2**：`report-writer.test.ts` 增用例：`parseOutlineJson` 输入 `<think>…</think>` + 含 6 个 sections 的 JSON，断言 `sections.length === 6` 且非 `defaultOutline`。
**AC-3**：`planner` / `clarifier` / `reflector` / `query-expander` 各自测试文件增一条 think 前缀用例，断言不再回落。

---

## FR-2 收尾摘要剥离 think

`completion-summary.ts:95-105 buildCompletionSummary`：

before
```ts
const text = (raw ?? "").trim();
if (!text) return fallbackSummary(input);
return truncate(text, COMPLETION_SUMMARY_MAX_CHARS);
```

after
```ts
const text = stripThinkBlocks(raw ?? "").trim();
if (!text) return fallbackSummary(input);
return truncate(text, COMPLETION_SUMMARY_MAX_CHARS);
```

顺序关键：**必须先剥 think 再 truncate**，否则超长 think 会把摘要正文挤出截断窗口。

**AC-4**：`completion-summary.test.ts` 增用例：`callJson` 返回 `<think>` + 2000 字思考 + `\n\n本次调研完成…`，断言结果不含「思考」痕迹、以摘要正文开头、且不等于 `fallbackSummary`；再增一例返回**纯 think 无正文**，断言回落 `fallbackSummary`。

---

## FR-3 时间预算 20 分钟 + 写作阶段预留

`orchestrator.ts:75`：`TOTAL_BUDGET_MS = 600_000` → `1_200_000`（20 分钟，对齐用户预期的 10–25 分钟异步节奏）。

仅提总预算不足以保证写完——检索阶段仍可能吃满。新增写作预留：

在 `orchestrator.ts` 常量区（`TOTAL_BUDGET_MS` 附近）新增：

```ts
/** 每节写作的保守耗时估算，用于反推检索阶段的截止线。 */
export const SECTION_WRITE_ESTIMATE_MS = 45_000;
/** 写作阶段最低保留预算，无论检索多耗时都不得侵占。 */
export const WRITE_RESERVE_MIN_MS = 240_000;
```

在进入 lanes / reflect 的预算判断处（`orchestrator.ts:682`、`776`、`806`、`1032` 现有 `budgetLeft()` 比较点），把检索侧的判据从 `budgetLeft() <= 0` / `budgetLeft() > REFLECT_MIN_BUDGET_MS` 改为基于 `searchBudgetLeft()`：

```ts
const searchBudgetLeft = () => budgetLeft() - WRITE_RESERVE_MIN_MS;
```

即：检索/反思阶段一旦 `searchBudgetLeft() <= 0` 就收尾进入写作，把剩下的 ≥4 分钟留给分节写作。写作循环（`orchestrator.ts:1205`）继续用原 `budgetLeft() <= 0` 判据。

注意：`budgetPausedMs`（澄清等待期）已在 `budgetLeft()` 内扣除，`searchBudgetLeft()` 直接复用即可，不要重复处理。

**AC-5**：`orchestrator.test.ts` 增用例，用假 clock 让检索阶段消耗至 `TOTAL_BUDGET_MS - WRITE_RESERVE_MIN_MS + 1`，断言 lanes 提前收尾且 `final-report.md` 产物中**不含**「因时间预算截断」字样。
**AC-6**：现有 orchestrator 测试全绿（预算常量变化不得破坏既有断言；若某测试硬编码 600_000，改为引用导出常量而非改行为）。

---

## FR-4 首节「核心结论」写作定位

现状 `SECTION_SYSTEM`（`report-writer.ts:40-46`）对所有节一视同仁地要求 ≥1500 字展开论证，导致首节「核心结论」被写成长篇综述，与后续分项分析大面积重叠（用户导出的报告里，核心结论 5 大段几乎复述了分项分析全部内容）。

在 `report-writer.ts` 新增首节专用约束，并在 `buildSectionMessages`（`report-writer.ts:137`）中按 `args.sectionIndex === 0` 选择：

```ts
const LEAD_SECTION_SYSTEM = [
  "你是深度研究报告首节「核心结论」写作助手。",
  "本节是全文结论摘要，不是综述：用 4–8 条要点式结论呈现最关键判断，每条 1–3 句。",
  "目标篇幅 400–800 字，禁止展开机制细节与背景铺陈——那些属于后续分项分析章节。",
  "每条结论必须以 [N] 标注支撑证据，N 必须在证据包中存在。",
  "只输出本节 Markdown 正文，不要重复输出标题。",
].join("\n");
```

同时在 `SECTION_SYSTEM` 末尾补一句：`"本节不要重复首节已给出的结论表述，聚焦本节主题的机制、数据与论证。"`

**AC-7**：`report-writer.test.ts` 增用例：`buildSectionMessages({ sectionIndex: 0, … })` 的 system 消息含「400–800 字」，`sectionIndex: 1` 的 system 消息含 `${SECTION_TARGET_CHARS}`；两者不相同。

---

## 验收命令

```bash
cd enterprise/apps/web-portal
pnpm vitest run src/lib/deep-research
pnpm typecheck
```

全绿后，手动跑一次深度调研冒烟：观察 (a) 大纲章节数 ≥5；(b) 报告末尾无「因时间预算截断」；(c) 聊天区出现完成摘要正文而非空 Thinking 卡片。
