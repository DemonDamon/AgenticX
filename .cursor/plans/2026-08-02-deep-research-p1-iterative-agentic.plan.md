# P1 · 深度调研 Agentic 迭代：关键词扩展 + 来源池筛选 + 反思补搜循环

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: `gpt-5.6-terra-medium`（循环状态机 + 预算分配 + 去重一致性，序列敏感、回归面大）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`
Depends-On: P0（`2026-08-02-deep-research-p0-fulltext-longform.plan.md`）**必须先合入**

---

## 0. 一句话

P0 让每条来源变厚，P1 让来源变多、变好、且能自我纠错：
把 `plan-once → 搜一轮 → 写` 的直线，改成 `多关键词铺开 → 候选池筛选 → 反思找缺口 → 补搜` 的循环。

## 1. 根因与证据链

### 证据 1：一条车道只发一条 query
`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:617` 起的 `mapPool` 车道体内，
每条子问题只调用一次 `executeSearch`。8 条车道 = 8 个关键词。
Kimi 的量级是 **~74 个关键词**，差一个数量级。

### 证据 2：搜到即用，没有筛选
`orchestrator.ts:637-642`：
```typescript
              for (const hit of hits) {
                if (registry.size >= MAX_SOURCES) break;
                questionCitations.push(registry.add(hit));
              }
```
命中直接进 registry，**先到先得**，唯一的门槛是 `MAX_SOURCES` 截断。
Kimi 是「发现 206 → 筛出 3.2% ≈ 26」，采用率约 12.6%；我们接近 100%。
这就是为什么报告里混进了单一博客的「2026 年 4 月发布」这种低可信来源。

### 证据 3：没有反思环节
车道跑完直接进 `synthesize`（`orchestrator.ts:738`）。
模型只能在报告最后一节写「缺乏官方一手文献」——**发现了缺口却没有机会去补**。
这正是本次用户报告里最刺眼的一点：它知道缺权威来源，但流水线不给它再搜一次的机会。

### 可复用的既有能力
- `enterprise/apps/web-portal/src/lib/web-search/rerank.ts:92` 的 `rerankHits(query, hits)`，
  已实现 BM25(k1=1.5,b=0.75) + RRF 融合，**直接复用做候选池排序，不要另写打分器**。
- `registry.ts:14` 的 `normalizeCitationUrl`，复用做候选池去重键。
- `orchestrator.ts` 内已有的 `mapPool` 并发池与 `budgetLeft()` 预算守卫。

---

## 2. In scope / Out of scope

### In scope
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/query-expander.ts`
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/source-pool.ts`
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/reflector.ts`
- 改 `orchestrator.ts` 车道执行体与 lanes 阶段结构
- 改 `enterprise/packages/sdk-ts/src/deep-research.ts` 与
  `enterprise/packages/core-api/src/chat.ts`（新增事件类型，两处**必须同步**）
- 改 `enterprise/features/chat/src/components/molecules/deep-research-segments.ts`（渲染新事件）
- 相应单测

### Out of scope（**违反即回退**）
- 不改 `rerank.ts` 的打分公式。
- 不改 `clarifier.ts` / `recon.ts` / `planner.ts` 的行为。
- 不改 `page-fetch.ts`（P0 产物，只调用）。
- 不做异步化（P2）、不做交付物（P3）。
- 补搜**最多一轮**，不做不定轮次的 while 循环——预算不可控，且容易在网络抖动时空转。

---

## 3. FR-1：关键词扩展

**新建** `enterprise/apps/web-portal/src/lib/deep-research/query-expander.ts`。

### 契约
```typescript
/** 每条子问题展开的 query 变体数（含原问题本身）。 */
export const MIN_VARIANTS_PER_LANE = 3;
export const MAX_VARIANTS_PER_LANE = 6;

export type QueryVariant = {
  /** 实际发给搜索 provider 的字符串。 */
  query: string;
  /** 变体意图，用于事件展示：原问 / 术语 / 英文 / 权威源 / 时效 / 反面。 */
  kind: "primary" | "term" | "english" | "authority" | "recency" | "contrarian";
};

export type ExpandDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  subQuestion: string;
  todayLine: string;
};

export function parseVariantsJson(raw: string, subQuestion: string): QueryVariant[];

/** LLM 扩展失败时回落到 heuristicVariants，绝不抛。 */
export async function expandQueries(deps: ExpandDeps): Promise<QueryVariant[]>;

/** 不依赖 LLM 的确定性回落。 */
export function heuristicVariants(subQuestion: string): QueryVariant[];
```

### `heuristicVariants` 具体规则（照此实现）
以 `subQuestion` 为基准生成，去重后返回：
1. `{ query: subQuestion, kind: "primary" }`
2. `{ query: \`${subQuestion} 技术报告 论文\`, kind: "authority" }`
3. `{ query: \`${subQuestion} 官方 文档\`, kind: "authority" }`
4. 若 `subQuestion` 含 CJK 字符（复用 `rerank.ts:7` 的 `CJK_CHAR` 同款判断，**在本文件内自建常量，
   不要去改 `rerank.ts` 的导出**），追加 `{ query: \`${subQuestion} english\`, kind: "english" }`

### LLM 扩展 prompt 要点
- 只输出 JSON 数组，无围栏：`[{"query":"...","kind":"term"}]`
- 条数 `MIN_VARIANTS_PER_LANE`–`MAX_VARIANTS_PER_LANE`。
- 必须包含一条 `primary`（原问题原文）。
- 变体要覆盖：专业术语同义改写、英文检索式、指向权威源（论文 / 官方文档 / 技术报告）、
  时效限定（结合 `todayLine` 的当前年份）、以及一条**反面/质疑向**检索
  （如「X 争议」「X 局限」），用于交叉验证。
- 禁止输出彼此近乎重复的变体。

`parseVariantsJson` 容错：剥围栏、非数组回落 `heuristicVariants`、
按 `query` 归一化（`trim().toLowerCase()`）去重、截断到 `MAX_VARIANTS_PER_LANE`、
若结果为空回落 `heuristicVariants`。

### AC-1
`query-expander.test.ts`：
- 带 ```json 围栏可解析。
- 重复 query 被去重。
- 超过上限被截断。
- 非法输入 / 空数组回落 `heuristicVariants` 且含 `primary`。
- `heuristicVariants` 对纯 ASCII 输入不产出 `english` 变体，对中文输入产出。

---

## 4. FR-2：候选来源池与质量筛选

**新建** `enterprise/apps/web-portal/src/lib/deep-research/source-pool.ts`。

### 设计
车道内所有变体的命中先进**候选池**（不进 registry），全部搜完后统一打分排序，
只把 Top-N 提升为正式 citation 去抓正文。这样才有「206 发现 → 26 采用」的筛选比。

### 契约
```typescript
import type { WebSearchHit } from "../web-search/providers";

export type PooledHit = {
  hit: WebSearchHit;
  /** 命中该结果的所有变体 query。 */
  matchedQueries: string[];
  /** 被不同变体重复命中的次数，是强相关信号。 */
  hitCount: number;
};

export type ScoredHit = PooledHit & { score: number };

export class SourcePool {
  /** 按 normalizeCitationUrl 去重合并；重复命中累加 hitCount。 */
  add(hit: WebSearchHit, query: string): void;
  list(): PooledHit[];
  get size(): number;
}

/** 域名权威度加成，0–1。 */
export function authorityBoost(url: string): number;

/**
 * 综合排序：
 *   score = 0.55 * rrfFromRerank + 0.25 * authorityBoost + 0.20 * repeatBoost
 * rrfFromRerank 由 rerankHits(topic, hits) 的名次换算：1 / (60 + rank)，再归一化到 0–1。
 * repeatBoost = min(1, (hitCount - 1) / 2)
 */
export function scorePool(topic: string, pool: PooledHit[]): ScoredHit[];

/** 取 TopN，并强制单域名不超过 maxPerDomain 条，保证来源多样性。 */
export function selectTopSources(
  scored: ScoredHit[],
  topN: number,
  maxPerDomain?: number,
): ScoredHit[];
```

### `authorityBoost` 规则（照此实现）
按 hostname 判定，取最高档：
- `1.0`：`arxiv.org`、`*.edu`、`*.ac.*`、`*.gov`、`nature.com`、`science.org`、`ieee.org`、`acm.org`
- `0.8`：`github.com`、`huggingface.co`、`*.openai.com`、`*.deepseek.com`、`*.anthropic.com`、
  以及路径含 `/docs/` 或 `/blog/` 的 **官方域**（判定：hostname 与主题词干无关时不加成，
  实现上简化为上述白名单命中即可，**不要做主题相关性推断**）
- `0.5`：`zhihu.com`、`medium.com`、`infoq.cn`、`csdn.net` 等技术社区
- `0.2`：其它

**必须导出一个可读的白名单常量表**（如 `AUTHORITY_TIERS`），便于后续维护与单测。

### `selectTopSources`
- `maxPerDomain` 默认 `3`。
- 按 score 降序遍历，域名配额满则跳过，直到取满 `topN` 或候选耗尽。
- **确定性**：同分时按原 pool 顺序稳定排序（供单测断言）。

### AC-2
`source-pool.test.ts`：
- `SourcePool.add` 对 `https://a.com/x?utm_source=y` 与 `https://a.com/x` 合并为一条，`hitCount === 2`，
  `matchedQueries` 含两条 query。
- `authorityBoost("https://arxiv.org/abs/1")` > `authorityBoost("https://zhuanlan.zhihu.com/p/1")`
  > `authorityBoost("https://random-blog.xyz/a")`。
- `scorePool` 中被 3 个变体重复命中的低权威结果，能排到只被 1 个变体命中的同权威结果之前。
- `selectTopSources(scored, 10, 2)` 对全部同域名的候选只返回 2 条。
- `selectTopSources` 在候选不足 topN 时返回全部且不抛。

---

## 5. FR-3：车道改为「多变体 → 池 → 筛选 → 抓正文」

**改** `orchestrator.ts` 车道执行体（P0 改造后的版本，约 `L620-720` 区间）。

### 新流程（替换车道体内「单次 executeSearch + 直接 registry.add」那段）
```
1. variants = await expandQueries({ callJson, topic, subQuestion: question, todayLine })
   → enqueueEvent lane_progress: `已展开 ${variants.length} 条检索式`
2. pool = new SourcePool()
   对 variants 并发（沿用 SEARCH_CONCURRENCY）执行 executeSearch，命中全部 pool.add(hit, variant.query)
   单条变体失败只 console.warn 并继续，不计入 searchFailures
   → enqueueEvent lane_progress: `发现 ${pool.size} 个候选来源`
3. scored = scorePool(plan.topic, pool.list())
   selected = selectTopSources(scored, resultsPerLane)
   → enqueueEvent lane_progress: `筛选出 ${selected.length}/${pool.size} 个高质量来源`
4. selected 依次 registry.add → questionCitations（保留 MAX_SOURCES 守卫）
5. 抓正文（P0 已有逻辑，不变）
6. 车道备忘（P0 已有逻辑，不变）
```

### 失败判定的调整（**易错点**）
现有 `searchFailures` 语义是「整条车道搜索失败」。改造后一条车道有多个变体，
**只有当该车道所有变体都失败时** `searchFailures += 1`。
`orchestrator.ts:728` 的
```typescript
        if (laneCitationCount === 0 && searchFailures >= questions.length) {
```
判定逻辑保持不变，无需改动。

### 车道内新增可观测字段
`SourcePool` 的 `size` 与 `selected.length` 需要累加到 run 级统计，
供 FR-5 的 `research_stats` 事件使用：在 lanes 循环外维护
`let totalDiscovered = 0; let totalSelected = 0; let totalQueries = 0;`，
车道返回值里带上这三个数并在 `mapPool` 结果聚合时累加。

### AC-3
`orchestrator.test.ts`：
- 注入 `executeSearch` 记录调用次数，断言 4 条车道 × 3 变体 = 12 次搜索调用。
- 断言同一 URL 被两条变体命中时，最终 citation 只出现一次。
- 断言部分变体抛异常时车道仍成功（`lane_done` 为 `ok`）。
- 断言全部变体失败时该车道 `lane_done` 为 `failed`。

---

## 6. FR-4：反思与补搜（最多一轮）

**新建** `enterprise/apps/web-portal/src/lib/deep-research/reflector.ts`。

### 契约
```typescript
export const MAX_GAPS = 4;
export const MAX_FOLLOWUP_QUERIES = 8;

export type ResearchGap = {
  id: string;
  /** 缺口描述，直接展示给用户。 */
  description: string;
  /** 针对该缺口的补搜检索式。 */
  queries: string[];
};

export type ReflectDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  /** 已完成车道的备忘汇总（非全量证据，控上下文）。 */
  laneMemos: Array<{ question: string; memo: string }>;
  todayLine: string;
};

export function parseGapsJson(raw: string): ResearchGap[];

/** 失败或无缺口时返回 []，绝不抛。 */
export async function reflectOnGaps(deps: ReflectDeps): Promise<ResearchGap[]>;
```

### reflect prompt 要点（`REFLECT_SYSTEM`）
- 只输出 JSON：`{"gaps":[{"id":"g1","description":"...","queries":["...","..."]}]}`；无缺口输出 `{"gaps":[]}`。
- **重点判据（直接写进 prompt）**：
  - 关键结论是否只有**单一来源**支撑，缺乏交叉验证；
  - 是否缺少**官方一手文献**（论文 / 技术报告 / 官方文档），只有二手博客；
  - 是否存在**互相矛盾**的说法未被澄清；
  - 是否有**时间线 / 数字**未被权威来源确认。
- `gaps` 最多 `MAX_GAPS` 条，每条 1–3 个 `queries`。
- 只报**能靠再搜一次解决**的缺口；纯粹「尚无公开信息」的不要报。

### orchestrator 接线
在 lanes 阶段结束后、`synthesize` 之前（P0 改造后约 `L736` 位置）插入：

```
if (budgetLeft() > REFLECT_MIN_BUDGET_MS) {
  enqueueEvent({ type: "phase", phase: "reflect", message: "正在复盘已收集证据，识别信息缺口…" })
  gaps = await reflectOnGaps({...})
  if (gaps.length > 0) {
    enqueueEvent({ type: "reflection", gaps: gaps.map(g => g.description) })
    enqueueEvent({ type: "narrative", text: `发现 ${gaps.length} 处信息缺口，正在补充检索。` })
    对每个 gap 起一条 lane（laneId = `gap-${g.id}`），复用 lane_started / lane_progress / lane_done 事件，
    走「搜索 → pool → 筛选 → registry.add → 抓正文 → 备忘」同一套逻辑，
    补搜结果作为额外 citationsByQuestion 条目追加（question 用 g.description）
  } else {
    enqueueEvent({ type: "narrative", text: "证据交叉验证充分，未发现需要补搜的缺口。" })
  }
}
```

新增常量（放在 `orchestrator.ts` 常量区，紧邻 `FETCH_BUDGET_MS`）：
```typescript
/** 低于此预算则跳过反思补搜，直接进综述。 */
export const REFLECT_MIN_BUDGET_MS = 150_000;
```

**关键约束**：补搜只做一轮，补搜车道**不再触发 reflect**，避免无界递归。

### AC-4
`reflector.test.ts`：
- `parseGapsJson` 解析带围栏输出；`{"gaps":[]}` 返回 `[]`；非法输入返回 `[]` 且不抛。
- `gaps` 超过 `MAX_GAPS` 被截断；单个 gap 的 `queries` 为空时该 gap 被丢弃。

`orchestrator.test.ts`：
- 注入 `reflectFn` 返回 2 个 gap，断言额外出现 2 条 `gap-*` 车道、最终 citation 数增加。
- 注入 `reflectFn` 返回 `[]`，断言不产生额外车道且直接进 synthesize。
- 断言 `budgetLeft() < REFLECT_MIN_BUDGET_MS` 时**完全跳过** reflect（`reflectFn` 未被调用）。
- 断言补搜车道内不会再次调用 `reflectFn`（调用次数恰为 1）。

---

## 7. FR-5：新增 SSE 事件类型（三处同步）

### 7.1 `enterprise/packages/sdk-ts/src/deep-research.ts`
`phase` 联合类型（`L7`）新增 `"reflect"`：
```typescript
      phase: "recon" | "clarify" | "plan" | "lanes" | "reflect" | "synthesize" | "done";
```
并在 `DeepResearchEvent` 联合中新增两个成员（加在 `L32` 的 `narrative` 之前）：
```typescript
  | { type: "reflection"; gaps: string[] }
  | {
      type: "research_stats";
      queriesPlanned: number;
      urlsDiscovered: number;
      sourcesSelected: number;
      pagesFetched: number;
    }
```

### 7.2 `enterprise/packages/core-api/src/chat.ts`
同一 `DeepResearchEvent` 定义**逐字同步**（该类型在两个包各有一份，历史遗留；
本次不做类型合并重构，只保持一致）。

### 7.3 `enterprise/features/chat/src/components/molecules/deep-research-steps.ts`
`phaseTitle` 新增 `case "reflect": return "复盘信息缺口";`

### 7.4 `enterprise/features/chat/src/components/molecules/deep-research-segments.ts`
- `reflection` 事件渲染为一个可折叠卡片，标题「发现 N 处信息缺口」，展开列出 `gaps`。
- `research_stats` 事件渲染为一行灰字统计：
  `检索式 N 条 · 发现 N 个来源 · 采用 N 个 · 读取正文 N 篇`，
  **在报告开始流式输出之前**展示。
- 参照现有 lane 卡片的折叠语义（默认折叠），不要新造交互风格。

### `research_stats` 发射时机
在 `synthesize` 阶段开始前发射一次，数据取自 FR-3 累加的 `totalQueries / totalDiscovered /
totalSelected` 与 P0 抓正文成功计数。

### AC-5
- `deep-research-segments.test.ts` 新增：`reflection` 事件产出一个 segment 且含缺口文案；
  `research_stats` 事件产出统计行。
- `pnpm --filter @agenticx/sdk-ts typecheck` 与 `@agenticx/core-api` 均通过（两处定义一致）。

---

## 8. 验收命令

```bash
cd enterprise
pnpm --filter @agenticx/web-portal test -- src/lib/deep-research
pnpm --filter @agenticx/chat test -- deep-research
pnpm --filter @agenticx/web-portal typecheck
pnpm --filter @agenticx/sdk-ts typecheck
pnpm --filter @agenticx/core-api typecheck
```

### 人工回归（同一 query「deepseek v4 核心技术点」）
- **AC-P1-1** `research_stats` 显示检索式 ≥ 25 条、发现来源 ≥ 100 个。
- **AC-P1-2** 采用率 ≤ 35%（`sourcesSelected / urlsDiscovered`）。
- **AC-P1-3** 至少出现一次 `reflection` 卡片，且缺口描述与「缺官方一手文献」这类真实问题吻合；
  随后能看到 `gap-*` 补搜车道。
- **AC-P1-4** 最终报告的「不确定性与信息缺口」一节，条目数**少于** P0 基线
  （说明补搜真的解决了部分缺口，而不是只会报告缺口）。
- **AC-P1-5** 单一域名来源占比 ≤ 30%。
