# 深度调研正文抓取：落盘留存 + 可插拔高可用抓取后端

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: `kimi-k2.7-code`（后端接线为主：HTTP 后端适配、artifact 落盘、配置解析，逻辑边界清晰且有单测兜底）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`
Depends-On: P0（`2026-08-02-deep-research-p0-fulltext-longform.plan.md`）已合入

---

## 0. 一句话

P0 把正文抓取接上了，但实网跑下来经常是 `已读取 0/10 篇正文`，且抓到的正文**只存在内存里**，
进程一断就没了。本 plan 解决两件事：**正文落盘留存**，以及**把裸 HTTP 抓取换成可插拔的高可用后端**。

## 1. 根因与证据链

### 证据 1：裸 HTTP + 正则抽取，对现代网页命中率低
`enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts:122` 的 `fetchPageContent`：
- 只发一次 `directFetch` GET，拿到 HTML 后用正则去噪（`extractMainText`，同文件 `L108`）
- `L149` 非 `text/html` / `text/plain` 直接 `return null`
- `L155` 抽出的正文 `< MIN_USABLE_PAGE_CHARS`（400，`L13`）判定失败

于是三类页面**必然 0 命中**：JS 客户端渲染（抽到的是空壳）、反爬墙（返回验证页）、PDF/非 HTML。
实测截图里 `发现 21 个候选来源 → 筛选出 10 → 已读取 0/10 篇正文` 就是这个组合的结果。

### 证据 2：抓到的正文完全不落盘
`orchestrator.ts:861-862` 抓到后只做两件事：
```typescript
registry.attachFullText(citation.url, page.text);
citation.fullText = page.text;
```
`Citation.fullText` 是内存字段（`registry.ts:13`）。真正落库的只有
车道备忘 `memo.md`（`orchestrator.ts:909-921`）与终稿。因此：
- 排障时无法回看「到底抓到了什么」，只能看到 `0/10` 这个数字
- P2 的断线恢复能恢复事件与报告，但**恢复不了已抓正文**，重连后等于白抓

### 证据 3：抓取耗时不可观测，用户只能干等
`PAGE_FETCH_TIMEOUT_MS = 12_000`、`PAGE_FETCH_CONCURRENCY = 4`（`page-fetch.ts:10-11`）。
10 个来源全部超时 = 最坏 30s，且 UI 只有一句「正在读取正文…」，
失败后也只写 `已读取 0/10`，**不告诉用户为什么**（超时？反爬？非 HTML？）。

---

## 2. In scope / Out of scope

### In scope
- 改 `enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`：抽出后端接口 + 失败原因
- 新建 `enterprise/apps/web-portal/src/lib/web-search/page-fetch-backends.ts`：native / jina / firecrawl
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/page-archive.ts`：正文落盘
- 改 `orchestrator.ts`：落盘接线 + 失败原因汇总进 `lane_progress`
- 改 `enterprise/apps/web-portal/src/lib/web-search/config.ts`：新增抓取后端配置解析
- 相应单测

### Out of scope（**违反即回退**）
- **不引入 Playwright / Puppeteer / jsdom / @mozilla/readability 等新依赖**——
  高可用靠外部抓取服务（HTTP 调用）解决，不在 Next.js 进程里跑浏览器。
- 不改 `direct-fetch.ts` 一行（只复用）。
- 不改搜索 provider（`providers.ts`）与 `rerank.ts`。
- 不改 `clarifier.ts` / `recon.ts` / `planner.ts`。
- 不改 P1 的 `query-expander` / `source-pool` / `reflector`。
- 不做跨 run 的正文缓存复用（同一 run 内 `registry` 已按 URL 去重；跨 run 缓存另议）。
- 不新增数据库表——正文落盘复用既有 `artifact-store`。

---

## 3. FR-1：可插拔抓取后端

**新建** `enterprise/apps/web-portal/src/lib/web-search/page-fetch-backends.ts`。

### 契约
```typescript
import type { DirectFetch } from "./direct-fetch";

export type PageFetchBackendName = "native" | "jina" | "firecrawl";

/** 抓取失败原因，用于可观测性与 UI 提示。 */
export type PageFetchFailure =
  | "invalid_url"
  | "http_error"
  | "unsupported_content_type"
  | "too_short"
  | "timeout"
  | "network_error";

export type BackendResult =
  | { ok: true; text: string; rawChars: number }
  | { ok: false; reason: PageFetchFailure };

export type BackendDeps = {
  fetchImpl: DirectFetch;
  timeoutMs: number;
  signal?: AbortSignal;
  apiKey?: string;
};

export type PageFetchBackend = (url: string, deps: BackendDeps) => Promise<BackendResult>;

export const nativeBackend: PageFetchBackend;
export const jinaBackend: PageFetchBackend;
export const firecrawlBackend: PageFetchBackend;

export function resolveBackend(name: PageFetchBackendName): PageFetchBackend;
```

### `nativeBackend`
把 `page-fetch.ts:126-167` 现有逻辑**原样搬过来**，只把 `return null` 改成带 `reason` 的返回：
- URL 非法 / 非 http(s) → `invalid_url`
- `!res.ok` → `http_error`
- content-type 非 html/plain → `unsupported_content_type`
- 抽取结果 `< MIN_USABLE_PAGE_CHARS` → `too_short`
- 抛 `TimeoutError` / `AbortError` → `timeout`；其它异常 → `network_error`

**不要改 `extractMainText` 的算法**，它已有单测覆盖。

### `jinaBackend`（推荐默认的高可用档）
Jina Reader 直接返回抽好的 Markdown 正文，对 JS 渲染页命中率远高于裸 HTTP：
- 请求：`GET https://r.jina.ai/<原始 URL 原样拼接，不要 encodeURIComponent 整串>`
- header：`accept: text/plain`；`apiKey` 非空时加 `authorization: Bearer <key>`
- 响应体即正文文本，**无需再跑 `extractMainText`**
- 判定与 native 一致：`< MIN_USABLE_PAGE_CHARS` → `too_short`

无 key 也能用（有限流），有 key 更稳 —— 这是本 plan 选它做默认高可用档的理由。

### `firecrawlBackend`（企业自建 / 付费档）
- `POST https://api.firecrawl.dev/v1/scrape`，body `{ url, formats: ["markdown"] }`
- header：`content-type: application/json`、`authorization: Bearer <apiKey>`
- 取 `data.markdown`；`apiKey` 为空时直接返回 `{ ok:false, reason:"network_error" }`（不发请求）
- Base URL 允许被 `PAGE_FETCH_FIRECRAWL_BASE_URL` 覆盖以支持自建实例

### AC-1
`page-fetch-backends.test.ts`（全部用注入的 `fetchImpl` 假响应，**不打真网**）：
- `nativeBackend` 对 `application/pdf` 返回 `unsupported_content_type`
- `nativeBackend` 对短正文返回 `too_short`
- `jinaBackend` 请求 URL 以 `https://r.jina.ai/` 开头且包含原始 URL
- `jinaBackend` 有 apiKey 时带 `authorization` 头，无 key 时不带
- `firecrawlBackend` 无 key 时不发请求
- `firecrawlBackend` 解析 `data.markdown`
- 三个后端在 `fetchImpl` 抛异常时都返回 `{ ok:false }` 而**不抛**

---

## 4. FR-2：`page-fetch.ts` 接入后端 + 回退链

**改** `enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`。

### 新增导出
```typescript
export const DEFAULT_BACKEND_CHAIN: PageFetchBackendName[] = ["native", "jina"];

export type PageContent = {
  url: string;
  text: string;
  rawChars: number;
  /** 实际产出正文的后端，用于落盘元信息与排障。 */
  backend: PageFetchBackendName;
};

export type PageFetchDeps = {
  fetchImpl?: DirectFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 依次尝试，首个成功即返回；缺省用 DEFAULT_BACKEND_CHAIN。 */
  backends?: PageFetchBackendName[];
  apiKeys?: Partial<Record<PageFetchBackendName, string>>;
};

/** 最近一次批量抓取的失败原因计数（供事件展示）。 */
export type FetchStats = Record<PageFetchFailure, number>;

export async function fetchPagesBatch(
  urls: string[],
  deps?: PageFetchDeps & { concurrency?: number },
): Promise<{ pages: Array<PageContent | null>; stats: FetchStats }>;
```

> **破坏性变更提醒**：`fetchPagesBatch` 返回值由数组改为 `{ pages, stats }`。
> 调用点只有 `orchestrator.ts:847`，以及测试里的 `fetchPagesFn` 替身，
> 必须同步改（见 FR-4）。`PageContent` 保持向后兼容地新增 `backend` 字段。

### 回退链行为
`fetchPageContent` 依次跑 `backends`：
- 首个 `ok: true` 即返回
- 全部失败 → 返回 `null`，并把**最后一次**的 `reason` 计入 stats
- `invalid_url` 与 `unsupported_content_type` 属于**确定性失败**，命中后**不再尝试后续后端**
  （换 Jina 也读不出 PDF，白白多花一次往返）

### AC-2
`page-fetch.test.ts` 现有用例按新返回结构调整，并新增：
- native 失败（`too_short`）时自动回退到 jina 且最终成功，`backend === "jina"`
- `unsupported_content_type` 不触发回退（断言 `fetchImpl` 只被调用一次）
- `stats` 正确累计各类失败次数
- 保序性仍成立（`pages[i]` 对应 `urls[i]`）

---

## 5. FR-3：正文落盘

**新建** `enterprise/apps/web-portal/src/lib/deep-research/page-archive.ts`。

### 为什么不新建表
`artifact-store.ts` 已有 PG / MySQL / 内存三态与租户隔离，正文就是一种 artifact。
**但不能直接共用配额**：`MAX_ARTIFACTS_PER_RUN = 40`（`artifact-store.ts:12`）是给
memo + 终稿 + HTML 报告用的，正文动辄几十篇会把配额吃光，导致终稿写不进去。

### 契约
```typescript
export const MAX_ARCHIVED_PAGES_PER_RUN = 60;
/** 单篇落盘上限，低于 artifact-store 的 512KB 硬顶。 */
export const MAX_ARCHIVE_CHARS = 20_000;

/** URL → 稳定短 id，用作落盘文件名。 */
export function pageArchiveKey(url: string): string;

export function pageArchivePath(runId: string, url: string): string;

/** 写入一篇正文；超配额或写失败都静默跳过，绝不影响主流程。 */
export async function archivePage(input: {
  artifactStore: ArtifactStore;
  tenantId: string; userId: string; sessionId: string; runId: string;
  url: string; title: string; backend: string; text: string;
  archivedSoFar: number;
}): Promise<boolean>;
```

- `pageArchiveKey`：对 `normalizeCitationUrl(url)`（复用 `registry.ts:14`）做稳定哈希，
  取 16 位十六进制。**必须是纯函数、无随机**，便于单测与幂等重写。
- `pageArchivePath`：`research/<runId>/pages/<key>.md`
- 落盘内容为带 front-matter 的 Markdown：
  ```
  ---
  url: <原始 URL>
  title: <标题>
  backend: <native|jina|firecrawl>
  chars: <字符数>
  ---

  <正文>
  ```
- `kind: "other"`、`mimeType: "text/markdown"`

### 开关
`config.ts` 新增（见 FR-5）`archivePages: boolean`，默认 **true**。
关闭时 `archivePage` 直接返回 `false`，不写库。

### AC-3
`page-archive.test.ts`（用 `createMemoryArtifactStore`）：
- `pageArchiveKey` 对 `?utm_source=` 变体与去尾斜杠变体返回**同一** key
- `pageArchivePath` 形如 `research/r1/pages/<16位hex>.md`
- 落盘内容含 front-matter 的 `url:` / `backend:` 行与正文
- `archivedSoFar >= MAX_ARCHIVED_PAGES_PER_RUN` 时返回 `false` 且不写入
- 正文超 `MAX_ARCHIVE_CHARS` 被截断
- `artifactStore.write` 抛异常时返回 `false` 而**不抛**

---

## 6. FR-4：orchestrator 接线

**改** `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`。

### 6.1 适配新返回结构（`L847` 附近）
Before：
```typescript
const pages = await fetchPages(
  questionCitations.map((c) => c.url),
  { signal: deps.signal, timeoutMs: ... },
);
let pagesFetched = 0;
pages.forEach((page, i) => { ... });
```
After：
```typescript
const { pages, stats } = await fetchPages(
  questionCitations.map((c) => c.url),
  {
    signal: runSignal,
    timeoutMs: ...,
    backends: fetchBackends,
    apiKeys: fetchApiKeys,
  },
);
let pagesFetched = 0;
for (const [i, page] of pages.entries()) {
  if (!page) continue;
  const citation = questionCitations[i];
  if (!citation) continue;
  registry.attachFullText(citation.url, page.text);
  citation.fullText = page.text;
  pagesFetched += 1;
  if (archiveEnabled) {
    const ok = await archivePage({
      artifactStore, tenantId, userId, sessionId, runId,
      url: citation.url, title: citation.title,
      backend: page.backend, text: page.text,
      archivedSoFar: pagesArchived,
    });
    if (ok) pagesArchived += 1;
  }
}
```

`pagesArchived` 是 run 级计数器，与 `artifactsWritten`（`L530`）**分开维护**，
声明在同一处附近。

> **注意 signal**：P2 已引入 `runSignal` / `transportClosed` 双信号。
> 这里必须传 `runSignal`，**不要**传 `deps.signal`，否则用户关页会中断抓取。

### 6.2 失败原因进 UI
现有事件（`L868`）：
```typescript
message: `已读取 ${pagesFetched}/${questionCitations.length} 篇正文`
```
改为在有失败时附带原因摘要：
```typescript
const failureNote = summarizeFetchFailures(stats); // "3 超时 · 2 反爬/非HTML"
message: failureNote
  ? `已读取 ${pagesFetched}/${questionCitations.length} 篇正文（${failureNote}）`
  : `已读取 ${pagesFetched}/${questionCitations.length} 篇正文`,
```

`summarizeFetchFailures` 放在 `page-fetch.ts` 并导出，中文映射：
`timeout`→超时、`http_error`→请求失败、`unsupported_content_type`→非网页内容、
`too_short`→正文过短、`network_error`→网络错误、`invalid_url`→链接无效。
只列**计数最高的前 2 类**，避免消息过长。

### 6.3 测试替身同步
`orchestrator.test.ts` 中所有 `fetchPagesFn` 替身（`baseDeps` 默认值与各用例）
返回值改为 `{ pages: urls.map(() => null), stats: {} as FetchStats }`。
**这是本次唯一会波及多处测试的改动，逐个改，不要漏。**

### AC-4
`orchestrator.test.ts` 新增：
- 注入成功的 `fetchPagesFn` + 内存 artifactStore，断言产生
  `research/<runId>/pages/*.md` 的 artifact 记录
- 注入 `stats: { timeout: 3 }`，断言 `lane_progress` 消息含「超时」
- `archivePages` 关闭时不产生 pages artifact
- 落盘抛异常时 run 仍正常完成

---

## 7. FR-5：配置

**改** `enterprise/apps/web-portal/src/lib/web-search/config.ts`。

`TenantWebSearchRow` 新增可选字段（**追加，不要重排既有字段**）：
```typescript
  /** 逗号分隔的后端链，如 "native,jina"。 */
  pageFetchBackends?: string;
  pageFetchJinaApiKey?: string;
  pageFetchFirecrawlApiKey?: string;
  archivePages?: boolean;
```

新增导出：
```typescript
export type PageFetchRuntimeConfig = {
  backends: PageFetchBackendName[];
  apiKeys: Partial<Record<PageFetchBackendName, string>>;
  archivePages: boolean;
};

export function resolvePageFetchConfig(tenant: TenantWebSearchRow): PageFetchRuntimeConfig;
```

解析优先级与既有 `resolveWebSearchConfig`（`config.ts:23`）**保持一致**：租户行 → env → 默认。
env 变量：
- `PAGE_FETCH_BACKENDS`（默认 `native,jina`）
- `PAGE_FETCH_JINA_API_KEY`
- `PAGE_FETCH_FIRECRAWL_API_KEY`
- `PAGE_FETCH_FIRECRAWL_BASE_URL`
- `PAGE_FETCH_ARCHIVE`（`"0"` / `"false"` 关闭，默认开）

非法后端名静默丢弃；全部非法则回落 `DEFAULT_BACKEND_CHAIN`。

> 本期**不做** admin-console 的配置 UI（租户列若暂无这些字段，走 env 即可）。
> 如需入库配置，另开 plan 并同步 PG/MySQL schema。

### AC-5
`config.test.ts`（或既有 web-search 配置测试文件）新增：
- 无租户行 + 无 env → `["native","jina"]`、`archivePages === true`
- `PAGE_FETCH_BACKENDS="jina"` → `["jina"]`
- `PAGE_FETCH_BACKENDS="bogus,native"` → `["native"]`
- `PAGE_FETCH_BACKENDS="bogus"` → 回落默认链
- `PAGE_FETCH_ARCHIVE="0"` → `archivePages === false`
- 租户行字段优先于 env

---

## 8. 验收

```bash
cd /Users/damon/myWork/AgenticX/enterprise/apps/web-portal
pnpm exec vitest run src/lib/web-search src/lib/deep-research
pnpm exec tsc --noEmit
```

已知**先于本次改动存在**的失败不需处理：
`src/store.interrupt.test.ts`、`zip-store.ts`、`deep-research-artifact-tree.ts` 的 typecheck 报错。

### 人工回归（同一 query「deepseek v4 核心技术点」）
- **AC-M1** 「已读取 N/10 篇正文」中 N **显著大于 0**（默认 native→jina 链，目标 ≥ 6/10）
- **AC-M2** 全部失败时消息带原因，如「已读取 0/10 篇正文（6 超时 · 4 非网页内容）」
- **AC-M3** run 结束后能在产物里看到 `research/<runId>/pages/` 下的正文文件，
  内容含 front-matter 的 `url` / `backend`
- **AC-M4** 把 `PAGE_FETCH_ARCHIVE=0` 后重跑，不再产生 pages 产物，其余行为不变
- **AC-M5** 断网 Jina（改 `PAGE_FETCH_BACKENDS=native`）时报告仍能产出，仅正文命中率下降

## 9. 已知限制（如实记录，不对外含糊）

- Jina Reader / Firecrawl 都是**外部服务**：调用会把目标 URL 发给第三方。
  对内网 / 敏感 URL 不应启用，需要时把租户后端链设为 `native`。
  这一点在做 admin 配置 UI 时必须在界面上说明。
- 无 key 的 Jina 有限流，高并发下可能返回 429（计入 `http_error`）。
- 正文落盘走 `artifact-store`，随会话数据一起留存；本期**不做**自动清理策略。
