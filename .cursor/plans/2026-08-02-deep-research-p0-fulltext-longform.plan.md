# P0 · 深度调研信息密度地基：网页正文抓取 + 预算放开 + 分节长文写作

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: P0-A `kimi-k2.7-code`（正文抓取，纯后端接线） / P0-B `gpt-5.6-terra-medium`（分节写作，prompt 与流式收口）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`

---

## 0. 一句话

深度调研报告写不长，不是提示词问题，是**素材只有 600 字符的搜索摘要**、**报告只写一次 LLM 调用**、
**预算只给 180 秒**这三个物理天花板。P0 只拆这三个天花板，不改流水线形状。

## 1. 根因与证据链（实施者据此自行判断改动是否对症，不依赖对话记忆）

### 证据 1：全链路从未抓取网页正文
`enterprise/apps/web-portal/src/lib/web-search/providers.ts:12-18`

```typescript
export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};
```

同文件 `L10` `export const DEFAULT_SNIPPET_CHARS = 600;`。
`orchestrator.ts:37` `MAX_SOURCES = 32`。

素材总量上限 = `32 × 600 = 19,200 字符`。中文一万字报告需要的一手素材通常在 10 万字符量级。
**差 6 倍以上，这是算术封顶，调 prompt 无解。**

### 证据 2：报告只发起一次 LLM 调用
`orchestrator.ts:752-756`

```typescript
const upstream = await callGatewayStream(deps, {
  ...baseBody,
  stream: true,
  messages: synthMessages,
});
```

单次 completion 的输出上限由模型 `max_tokens` 决定（主流 4K–8K token ≈ 中文 3,000–6,000 字）。
**万字在单次调用里物理不可达。**

### 证据 3：预算自我设限
`orchestrator.ts:42` `export const TOTAL_BUDGET_MS = 180_000;`
`enterprise/apps/web-portal/src/app/api/chat/completions/route.ts:34` `export const maxDuration = 900;`

路由允许 900 秒，orchestrator 只用 180 秒，**白白浪费 720 秒**。

### 可复用的既有能力（不要重复造）
- `enterprise/apps/web-portal/src/lib/web-search/direct-fetch.ts:349` 导出的 `directFetch`，
  已实现 `curl → HTTP CONNECT → 直连` 三级回退，支持 `timeoutMs`，是 CN 网络下唯一可靠的出网方式。
  **正文抓取必须复用它，禁止直接用全局 `fetch`。**
- `orchestrator.ts:155-186` 的 `formatEvidencePack` 已支持 `background` 参数。

---

## 2. In scope / Out of scope

### In scope
- 新建 `enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`
- 改 `enterprise/apps/web-portal/src/lib/deep-research/registry.ts`（`Citation` 加正文字段）
- 改 `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`（常量、车道内抓正文、替换 synth）
- 相应单测

### Out of scope（**违反即回退**）
- 不改 `direct-fetch.ts` 一行。
- 不改 `providers.ts` 的 `WebSearchHit` 类型和任何 provider 实现（正文挂在 `Citation` 上，不污染搜索层）。
- 不改 `clarifier.ts` / `recon.ts` / `planner.ts` 的任何行为（上一个 plan 刚修好）。
- 不引入 Playwright / puppeteer / jsdom / readability 等新依赖，正文提取用正则 + 字符串处理自实现。
- 不做反思补搜循环（那是 P1）。
- 不做异步化（那是 P2）。
- 不做 HTML/PDF 交付物（那是 P3）。

---

## 3. FR-1：网页正文抓取模块

**新建** `enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`。

### 导出契约

```typescript
import { directFetch, type DirectFetch } from "./direct-fetch";

/** 单篇正文抓取上限；超出截断。 */
export const MAX_PAGE_CHARS = 12_000;
export const PAGE_FETCH_TIMEOUT_MS = 12_000;
export const PAGE_FETCH_CONCURRENCY = 4;
/** 正文短于此值视为抓取失败（多半是 JS 渲染页 / 反爬墙）。 */
export const MIN_USABLE_PAGE_CHARS = 400;

export type PageContent = {
  url: string;
  /** 提取后的纯文本正文，已截断到 MAX_PAGE_CHARS。 */
  text: string;
  /** 提取字符数（截断前），用于可观测性。 */
  rawChars: number;
};

export type PageFetchDeps = {
  fetchImpl?: DirectFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** 抓取并提取正文；任何失败都返回 null（调用方降级到 snippet），绝不抛。 */
export async function fetchPageContent(
  url: string,
  deps?: PageFetchDeps,
): Promise<PageContent | null>;

/** 并发批量抓取，保序返回，失败位置为 null。 */
export async function fetchPagesBatch(
  urls: string[],
  deps?: PageFetchDeps & { concurrency?: number },
): Promise<Array<PageContent | null>>;

/** 从 HTML 提取正文纯文本（导出以便单测）。 */
export function extractMainText(html: string): string;
```

### `extractMainText` 的具体算法（**照此实现，不要自由发挥**）

1. 先整段删除噪声标签**及其内容**（大小写不敏感、跨行）：
   `script`、`style`、`noscript`、`nav`、`header`、`footer`、`aside`、`form`、`svg`、`iframe`。
   正则形如 `/<script\b[^>]*>[\s\S]*?<\/script>/gi`，逐标签处理。
2. 再删 HTML 注释 `/<!--[\s\S]*?-->/g`。
3. **主体候选优先级**：依次尝试匹配 `<article ...>...</article>`、`<main ...>...</main>`、
   `<div[^>]*\b(?:id|class)="[^"]*\b(?:content|article|post|main)\b[^"]*"[^>]*>...</div>`。
   取**字符数最长**的那个匹配作为主体；三者都没命中则用 `<body>` 内容；再没有就用整串。
4. 块级标签转换为换行：把 `</p>`、`</div>`、`</li>`、`</h1>`–`</h6>`、`<br\s*/?>`
   替换为 `\n`，避免段落粘连成一坨。
5. 剥离剩余标签 `/<[^>]+>/g` → 空格。
6. 反转义实体：`&nbsp; &amp; &lt; &gt; &quot; &#39;`（与 `providers.ts:42-53` 的 `stripHtml` 保持一致的映射表；
   该函数未导出，**复制这段映射即可，不要去改 `providers.ts` 导出它**）。
7. 空白归一：行内多空格压成一个空格；连续 ≥3 个换行压成 `\n\n`；`trim()`。

### `fetchPageContent` 行为

- `fetchImpl ?? directFetch`，调用时传 `{ timeoutMs, signal, headers: { "user-agent": <桌面浏览器 UA>, accept: "text/html,*/*" } }`。
- 只接受 `http:` / `https:`；其它 scheme 直接返回 `null`。
- `res.ok === false` → `null`。
- `content-type` 不含 `text/html` 且不含 `text/plain` → `null`（跳过 PDF/图片，避免把二进制塞给模型）。
- 读到的 HTML 先按 `MAX_PAGE_CHARS * 8` 截断再解析，防止超大页面吃满内存。
- `extractMainText` 结果长度 `< MIN_USABLE_PAGE_CHARS` → 返回 `null`（视为失败，降级 snippet）。
- 结果超过 `MAX_PAGE_CHARS` → 截断并在尾部追加 `…`；`rawChars` 记录截断前长度。
- **整个函数用 try/catch 包住，任何异常返回 `null` 并 `console.warn("[page-fetch]", url, msg)`。**

### `fetchPagesBatch`
简单信号量并发池，默认 `PAGE_FETCH_CONCURRENCY`。**必须保序**（返回数组下标与入参 `urls` 一一对应）。

### AC-1
新建 `enterprise/apps/web-portal/src/lib/web-search/__tests__/page-fetch.test.ts`：
- `extractMainText` 能从含 `<script>`/`<nav>`/`<footer>` 的 HTML 中只提取 `<article>` 正文。
- `extractMainText` 在有 `<article>` 和 `<main>` 时取更长的那个。
- `</p>` / `<br>` 被转成换行，段落不粘连。
- 实体 `&amp;` `&nbsp;` 被正确反转义。
- `fetchPageContent` 在注入的 `fetchImpl` 返回 `content-type: application/pdf` 时返回 `null`。
- `fetchPageContent` 在正文不足 400 字符时返回 `null`。
- `fetchPageContent` 在 `fetchImpl` 抛异常时返回 `null` 而**不抛**。
- `fetchPagesBatch` 对 `[ok, fail, ok]` 返回 `[PageContent, null, PageContent]` 且顺序正确。

---

## 4. FR-2：`Citation` 携带正文

**改** `enterprise/apps/web-portal/src/lib/deep-research/registry.ts`。

### Before（`registry.ts:7-12`）
```typescript
export type Citation = {
  index: number;
  title: string;
  url: string;
  snippet: string;
};
```

### After
```typescript
export type Citation = {
  index: number;
  title: string;
  url: string;
  snippet: string;
  /** 抓取成功的网页正文；失败时 undefined，证据包降级用 snippet。 */
  fullText?: string;
};
```

`CitationRegistry` 新增方法（**不要改 `add` 的签名**，避免波及所有调用点）：

```typescript
/** 抓到正文后回填；URL 未注册时静默忽略。 */
attachFullText(url: string, fullText: string): void {
  const existing = this.byKey.get(normalizeCitationUrl(url));
  if (existing) existing.fullText = fullText;
}
```

### AC-2
`registry.test.ts` 补：`attachFullText` 能按归一化 URL 命中（`https://a.com/x?utm_source=y` 与
`https://a.com/x` 视为同一条）；未注册 URL 调用不抛错。

---

## 5. FR-3：预算与来源上限放开

**改** `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:37-42`。

### Before
```typescript
export const MAX_SOURCES = 32;
export const MAX_LANES = 8;
export const MIN_RESULTS_PER_LANE = 3;
export const MAX_RESULTS_PER_LANE = 8;
export const RECON_TIMEOUT_MS = 15_000;
export const TOTAL_BUDGET_MS = 180_000;
```

### After
```typescript
export const MAX_SOURCES = 40;
export const MAX_LANES = 8;
export const MIN_RESULTS_PER_LANE = 4;
export const MAX_RESULTS_PER_LANE = 10;
export const RECON_TIMEOUT_MS = 15_000;
/** route.ts maxDuration = 900s；留 300s 给综述与网络抖动。 */
export const TOTAL_BUDGET_MS = 600_000;
/** 车道内抓正文的时间上限，超出则该车道剩余来源只保留 snippet。 */
export const FETCH_BUDGET_MS = 180_000;
```

**注意**：`resolveResultsPerLane`（`orchestrator.ts:149-153`）依赖 `MAX_SOURCES` 与
`MIN/MAX_RESULTS_PER_LANE`，改常量后它自动适配，**不要另外改它的公式**。
但 `orchestrator.test.ts` 里断言 `resolveResultsPerLane` 具体数值的用例需要同步更新预期值。

### AC-3
- `orchestrator.test.ts` 中 `resolveResultsPerLane` 用例按新常量更新并通过。
- 不修改 `route.ts`。

---

## 6. FR-4：车道内抓取正文

**改** `orchestrator.ts` 车道执行体，位置在 `L640-650` 之间（`registry.add` 循环之后、
`lane_progress` 事件之前）。

### Before（`orchestrator.ts:637-649` 附近）
```typescript
              for (const hit of hits) {
                if (registry.size >= MAX_SOURCES) break;
                questionCitations.push(registry.add(hit));
              }

              enqueueEvent({
                type: "lane_progress",
                laneId,
                message: `已收集 ${questionCitations.length} 个来源`,
                sourcesCollected: questionCitations.length,
              });
```

### After
```typescript
              for (const hit of hits) {
                if (registry.size >= MAX_SOURCES) break;
                questionCitations.push(registry.add(hit));
              }

              enqueueEvent({
                type: "lane_progress",
                laneId,
                message: `已收集 ${questionCitations.length} 个来源，正在读取正文…`,
                sourcesCollected: questionCitations.length,
              });

              // 正文抓取：失败者保留 snippet，不影响车道成功判定。
              if (questionCitations.length > 0 && budgetLeft() > 0) {
                const pages = await fetchPages(
                  questionCitations.map((c) => c.url),
                  {
                    signal: deps.signal,
                    timeoutMs: Math.min(PAGE_FETCH_TIMEOUT_MS, Math.max(1_000, budgetLeft())),
                  },
                );
                let fetched = 0;
                pages.forEach((page, i) => {
                  if (!page) return;
                  const citation = questionCitations[i];
                  if (!citation) return;
                  registry.attachFullText(citation.url, page.text);
                  citation.fullText = page.text;
                  fetched += 1;
                });
                enqueueEvent({
                  type: "lane_progress",
                  laneId,
                  message: `已读取 ${fetched}/${questionCitations.length} 篇正文`,
                  sourcesCollected: questionCitations.length,
                });
              }
```

配套改动：
1. 文件顶部 import 区**只新增一行**（`orchestrator.ts:10` 之后，遵守 no-scope-creep，不要整段替换 import 区）：
   ```typescript
   import { fetchPagesBatch, PAGE_FETCH_TIMEOUT_MS } from "../web-search/page-fetch";
   ```
2. `DeepResearchDeps`（`orchestrator.ts:72-91`）新增一个可选注入项，供单测替身：
   ```typescript
     fetchPagesFn?: typeof fetchPagesBatch;
   ```
3. 在 orchestrator 内解析：`const fetchPages = deps.fetchPagesFn ?? fetchPagesBatch;`
   （放在其它 `deps.xxx ?? default` 的解析处附近，保持风格一致）。

### 车道备忘也改用正文
`orchestrator.ts:653-655` 的 `evidenceBits` 目前用 `c.snippet`：

Before:
```typescript
                const evidenceBits = questionCitations
                  .map((c) => `[${c.index}] ${c.title}\n${c.snippet}`)
                  .join("\n\n");
```
After（正文截断到 2,000 字符，防止车道备忘调用超上下文）：
```typescript
                const evidenceBits = questionCitations
                  .map((c) => {
                    const body = c.fullText
                      ? c.fullText.slice(0, 2_000)
                      : c.snippet;
                    return `[${c.index}] ${c.title}\n${body}`;
                  })
                  .join("\n\n");
```

### 证据包用正文
`orchestrator.ts:155-186` 的 `formatEvidencePack`：把渲染每条 citation 的
`摘要：${c.snippet}` 改为优先用正文，并标注来源形态，便于模型判断可信度：

```typescript
const body = c.fullText ? `正文节选：${c.fullText}` : `摘要：${c.snippet}`;
```

`background`（recon）段保持只用 snippet，**不抓正文**（recon 是快速校准，抓正文会拖慢开题）。

### AC-4
`orchestrator.test.ts` 新增：
- 注入 `fetchPagesFn` 返回正文，断言最终 `sources` SSE 中该 citation 有 `fullText`，
  且 `formatEvidencePack` 输出包含「正文节选」。
- 注入 `fetchPagesFn` 全部返回 `null`，断言 run 仍成功完成、证据包回落「摘要：」，
  **车道状态仍为 `ok`**（正文失败不得判定车道失败）。
- 注入 `fetchPagesFn` 抛异常，断言 run 不崩溃。

---

## 7. FR-5：分节长文写作（替换单次综述）

**新建** `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`。

### 设计
把「一次调用写完整报告」拆成 `大纲 → 逐节写作 → 拼接`，每节独立一次 LLM 调用，
从而绕过单次 `max_tokens` 上限。目标 6–9 节 × 每节 1,200–2,000 字 ≈ 1 万字。

### 导出契约
```typescript
export const MIN_SECTIONS = 5;
export const MAX_SECTIONS = 9;
export const SECTION_TARGET_CHARS = 1_500;

export type ReportSection = {
  id: string;
  /** 章节标题，不含 "##" 前缀。 */
  title: string;
  /** 该节要回答什么，写给下游写作调用看。 */
  brief: string;
  /** 该节应重点引用的证据编号。 */
  citationIndexes: number[];
};

export type ReportOutline = {
  title: string;
  sections: ReportSection[];
};

export type OutlineDeps = {
  callJson: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  topic: string;
  evidence: string;
};

export function parseOutlineJson(raw: string, fallbackTitle: string): ReportOutline;

export async function buildReportOutline(deps: OutlineDeps): Promise<ReportOutline>;

export function buildSectionMessages(args: {
  outline: ReportOutline;
  section: ReportSection;
  sectionIndex: number;
  evidence: string;
  previousSummaries: string[];
}): Array<{ role: string; content: string }>;

/** 由各节标题生成 Markdown 目录。 */
export function renderTableOfContents(outline: ReportOutline): string;
```

### 大纲 prompt 要点（`OUTLINE_SYSTEM`）
- 只输出 JSON，无 Markdown 围栏：
  `{"title":"...","sections":[{"id":"s1","title":"...","brief":"...","citation_indexes":[1,4,7]}]}`
- 章节数 `MIN_SECTIONS`–`MAX_SECTIONS`，按证据密度决定，宁少勿滥。
- 必须包含首节「核心结论」与末节「不确定性与信息缺口」，中间为分项分析。
- `citation_indexes` 只能引用证据包中真实存在的编号。
- 使用与用户提问相同的语言。

`parseOutlineJson` 需容错：剥 ```json 围栏、字段缺失时回落、`sections` 为空时构造
默认三节（核心结论 / 分项分析 / 不确定性与信息缺口），保证永不返回空大纲。

### 单节写作 prompt 要点（`SECTION_SYSTEM`）
- 只写当前这一节的正文，**不要重复输出标题**（标题由调用方拼），不要写其它章节内容。
- 目标篇幅 ≥ `SECTION_TARGET_CHARS` 字，展开论证、给具体数字与机制细节，禁止空话凑字。
- 每条事实必须 `[N]` 标注，N 必须在证据包中存在，禁止编造编号。
- `previousSummaries` 作为「前文已写内容摘要」传入，用于避免重复。

### orchestrator 接线
**改** `orchestrator.ts:738-767` 的 synthesize 段。

Before（要点）：`formatEvidencePack` → 单次 `callGatewayStream` → 转发 delta。

After（流程）：
1. `enqueueEvent({ type: "phase", phase: "synthesize", message: "正在拟定报告大纲…" })`
2. `const outline = await buildReportOutline({ callJson, topic: plan.topic, evidence })`
   （`callJson` 用现有 `callGatewayJson(deps, {...baseBody, messages})` 包一层）
3. `enqueueDelta(\`# ${outline.title}\n\n\`)` + `enqueueDelta(renderTableOfContents(outline))`
4. 逐节 **串行**（不可并行：后一节要看前文摘要，且并行会让流式输出乱序）：
   - `enqueueEvent({ type: "phase", phase: "synthesize", message: \`正在撰写第 ${i+1}/${n} 节：${section.title}\` })`
   - `enqueueDelta(\`\n\n## ${section.title}\n\n\`)`
   - `callGatewayStream` 流式转发该节正文（复用现有 `L767` 之后那段 reader/decoder 解析逻辑，
     抽成局部函数 `streamSectionInto(messages)` 供循环调用，**不要复制粘贴多份**）
   - 把本节前 200 字符 push 进 `previousSummaries`
   - **预算守卫**：每节开始前检查 `budgetLeft() <= 0`，超预算则停止后续章节，
     追加一行 `\n\n> 报告因时间预算截断，以下章节未展开：<剩余标题列表>` 后进入 sources 段。
5. 章节写完后照旧输出 sources SSE（**这段现有逻辑不要动**）。

### AC-5
新建 `enterprise/apps/web-portal/src/lib/deep-research/report-writer.test.ts`：
- `parseOutlineJson` 能解析带 ```json 围栏的输出。
- `parseOutlineJson` 在 `sections: []` 时回落默认三节。
- `parseOutlineJson` 在完全非 JSON 输入时回落默认三节且不抛。
- 章节数超过 `MAX_SECTIONS` 时被截断。
- `renderTableOfContents` 输出的目录条目数与章节数一致。
- `buildSectionMessages` 的 user 消息包含证据包与 `previousSummaries`。

`orchestrator.test.ts` 新增：
- mock 网关：大纲返回 4 节，断言最终输出中 `## ` 标题出现 4 次、包含目录。
- 断言预算耗尽时输出截断提示且 run 正常收尾（有 `[DONE]`）。

---

## 8. 验收命令

```bash
cd enterprise
pnpm --filter @agenticx/web-portal test -- src/lib/deep-research src/lib/web-search
pnpm --filter @agenticx/web-portal typecheck
```

已知**先于本次改动存在**的失败不需处理：`src/store.interrupt.test.ts`、`zip-store.ts` 的 typecheck 报错。

### 人工回归
本地起 `bash enterprise/scripts/start-dev-with-infra.sh`，在 `http://localhost:3000/workspace`
开深度调研问「deepseek v4 核心技术点」，确认：
- **AC-P0-1** 报告正文 ≥ 8,000 字，且开头有目录。
- **AC-P0-2** 至少 15 个来源被成功抓到正文（观察 `已读取 X/Y 篇正文` 事件）。
- **AC-P0-3** 全程耗时 > 3 分钟（证明预算真的放开了）且 < 15 分钟。
- **AC-P0-4** 断网 provider 或全部正文抓取失败时，报告仍能产出（降级到 snippet），不报错。
